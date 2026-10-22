import { createHash } from 'node:crypto';
import { z } from 'zod';
import { roadRequestSchema,estimateRoadTime,type RoadRequest,type RoadRoute,type RoadResult,type RoadStatus,type RoadSegment } from '../shared/road.js';
import type { GeoCity } from '../shared/geography.js';
import type { Geography } from './geography.js';
import { AppError } from './store.js';
import type { Sql } from './database.js';

type Config={amapKey?:string;hereKey?:string;timeoutMs?:number;fetch?:typeof fetch};
type PendingRoute=Promise<{route:RoadRoute;queriedAt:string}>;
const europeanCountries=new Set('AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH TR UA GB VA AX'.split(' '));
const urls={amap:'https://lbs.amap.com/api/webservice/guide/api/newroute',here:'https://docs.here.com/routing/docs/routing-v8-intro'};
const metric=z.union([z.number(),z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const summarySchema=z.object({length:metric,duration:metric});
const storedRouteSchema=z.object({segments:z.array(z.object({kind:z.enum(['road','ferry','railFerry','waiting']),name:z.string(),distanceMeters:z.number().finite().nonnegative(),durationSeconds:z.number().finite().nonnegative()})).min(1),warnings:z.array(z.string()),roadNames:z.array(z.string()).optional()});
const segment=(kind:RoadSegment['kind'],name:string,distanceMeters:number,durationSeconds:number):RoadSegment=>({kind,name,distanceMeters,durationSeconds});
const noRoute=()=>new AppError(422,'未找到可用的普通驾车路线，请检查城市参考点及轮渡设置，不提供直线距离替代值');
function compact(segments:RoadSegment[]):RoadSegment[]{
  const result:RoadSegment[]=[];
  for(const s of segments){const last=result.at(-1);if(last?.kind==='road' && s.kind==='road'){last.distanceMeters+=s.distanceMeters;last.durationSeconds+=s.durationSeconds;}else result.push({...s});}
  return result;
}

export class RoadService {
  private config:Required<Pick<Config,'timeoutMs'|'fetch'>>&Config;
  private directInFlight=new Map<string,PendingRoute>();
  private databaseInFlight=new WeakMap<Sql,Map<string,PendingRoute>>();
  private active=0;
  constructor(config:Config={}){
    this.config={amapKey:config.amapKey ?? process.env.AMAP_WEB_SERVICE_KEY ?? process.env.AMAP_TRUCK_KEY,hereKey:config.hereKey ?? process.env.HERE_ROUTING_KEY,
      timeoutMs:config.timeoutMs ?? 12000,fetch:config.fetch ?? fetch};
  }
  status():RoadStatus{return {providers:[
    {id:'amap',name:'高德普通驾车',configured:!!this.config.amapKey,region:'中国大陆境内',setupUrl:urls.amap},
    {id:'here',name:'HERE 普通驾车',configured:!!this.config.hereKey,region:'美国及欧洲；以接口实际覆盖为准',setupUrl:urls.here},
  ],storage:'database'};}
  private amapFailure(data:any,stage:string):never{
    const code=String(data?.errcode ?? data?.infocode ?? '');
    const messages:Record<string,string>={
      '10001':'Key 不正确或已过期，请在本机重新配置 Web 服务 Key',
      '10002':'当前 Key 尚无所请求的普通路径规划权限，请检查 Web 服务配置',
      '10003':'日调用额度已用完，请检查套餐额度',
      '10004':'调用过于频繁，请稍后重试',
      '10005':'出口 IP 不在高德白名单中，请检查控制台配置',
      '10007':'数字签名验证未通过，请检查该 Key 的数字签名设置',
      '10009':'Key 的平台类型不匹配，请创建 Web 服务类型的 Key',
      '10012':'权限不足：该 Key 尚未获准使用所请求的服务，请在高德商务工单中申请开通',
      '10013':'Key 已被删除，请重新配置',
      '10014':'请求频率超过配额，请稍后重试',
    };
    throw new AppError(503,`${stage}未成功${/^\d+$/.test(code)?`（高德错误码 ${code}）`:''}：${messages[code] ?? '请检查服务权限、配额或参数'}`);
  }
  private async json(url:URL,signal:AbortSignal):Promise<any>{
    // Do not log URLs, upstream payloads or raw fetch exceptions: API keys are query parameters.
    try{
      const response=await this.config.fetch(url,{signal,redirect:'error'});
      if(response.status===401||response.status===403)throw new AppError(503,'路线服务授权失败，请检查 Web 服务 Key 及普通路径规划权限');
      if(response.status===429)throw new AppError(429,'路线服务调用额度或频率受限，请稍后重试或检查套餐');
      if(!response.ok)throw new AppError(502,'路线数据源暂不可用，请稍后重试');
      return await response.json();
    }catch(e){if(e instanceof AppError)throw e;if(signal.aborted)throw new AppError(504,'路线查询超时，请稍后重试');throw new AppError(502,'无法连接路线数据源，请检查网络及服务配置');}
  }
  private async amap(r:RoadRequest,origin:GeoCity,destination:GeoCity,signal:AbortSignal):Promise<RoadRoute>{
    const key=this.config.amapKey!;
    // GeoNames uses WGS84; use the official conversion service before Amap routing.
    const convert=new URL('https://restapi.amap.com/v3/assistant/coordinate/convert');
    convert.search=new URLSearchParams({key,coordsys:'gps',locations:[origin,destination].map(c=>`${c.longitude.toFixed(6)},${c.latitude.toFixed(6)}`).join('|')}).toString();
    const coords=await this.json(convert,signal);
    if(!coords || typeof coords!=='object')throw new AppError(502,'高德坐标转换返回格式异常');
    if(String(coords.status)!=='1')this.amapFailure(coords,'高德坐标转换');
    const locations=String(coords.locations ?? '').split(';');
    if(locations.length!==2 || !locations.every(p=>/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p)))throw new AppError(502,'高德坐标转换返回格式异常');
    const url=new URL('https://restapi.amap.com/v5/direction/driving');
    url.search=new URLSearchParams({key,origin:locations[0],destination:locations[1],strategy:'32',ferry:r.allowFerries ? '0' : '1',show_fields:'cost,navi',output:'json'}).toString();
    const data=await this.json(url,signal);
    if(!data || typeof data!=='object')throw new AppError(502,'高德路线数据格式异常');
    if(String(data.status)!=='1')this.amapFailure(data,'高德普通驾车查询');
    const pathSchema=z.object({distance:metric.refine(v=>v>0),duration:metric.refine(v=>v>0),restriction:z.coerce.number().optional(),steps:z.array(z.object({
      distance:metric,duration:metric,instruction:z.string().optional(),road:z.string().optional(),action:z.string().optional(),assistant_action:z.string().optional(),
    })).min(1)});
    const paths=data.route?.paths;
    if(!Array.isArray(paths)||!paths.length)throw noRoute();
    for(const raw of paths){
      const parsed=pathSchema.safeParse({distance:raw.distance,duration:raw.cost?.duration,restriction:raw.restriction,steps:Array.isArray(raw.steps)?raw.steps.map((s:any)=>({distance:s.step_distance ?? s.distance,duration:s.cost?.duration,instruction:typeof s.instruction==='string'?s.instruction:undefined,road:typeof s.road_name==='string'?s.road_name:undefined,action:typeof s.navi?.action==='string'?s.navi.action:undefined,assistant_action:typeof s.navi?.assistant_action==='string'?s.navi.assistant_action:undefined})):[]});if(!parsed.success)continue;const p=parsed.data;
      if(p.restriction!==undefined && p.restriction!==0)continue;
      const steps=p.steps.map(s=>{
        const text=[s.instruction,s.road,s.action,s.assistant_action].filter(Boolean).join(' ');
        const kind=/火车|列车|rail|shuttle/i.test(text) ? 'railFerry' : /轮渡|渡轮|乘船|航渡|ferry/i.test(text) ? 'ferry' : 'road';
        return segment(kind,kind==='road' ? '公路' : text.slice(0,160),s.distance,s.duration);
      });
      const distance=steps.reduce((n,s)=>n+s.distanceMeters,0),duration=steps.reduce((n,s)=>n+s.durationSeconds,0);
      // Partial step data must not silently reduce distance or driving time.
      if(Math.abs(distance-p.distance)>Math.max(100,p.distance*.01)||Math.abs(duration-p.duration)>Math.max(60,p.duration*.02))continue;
      if(!r.allowFerries && steps.some(s=>s.kind!=='road'))continue;
      // Reconcile rounding differences against the first road section.
      const road=steps.find(s=>s.kind==='road');
      if(road){road.distanceMeters+=p.distance-distance;road.durationSeconds+=p.duration-duration;if(road.distanceMeters<0||road.durationSeconds<0)continue;}
      const roads=[...new Set(p.steps.map(s=>s.road).filter((name):name is string=>!!name))],mainRoads=roads.filter(name=>/高速|国道|省道/.test(name));
      return {segments:compact(steps),warnings:[],roadNames:(mainRoads.length?mainRoads:roads).slice(0,12)};
    }
    throw noRoute();
  }
  private async here(r:RoadRequest,origin:GeoCity,destination:GeoCity,signal:AbortSignal):Promise<RoadRoute>{
    const url=new URL('https://router.hereapi.com/v8/routes');
    url.search=new URLSearchParams({apiKey:this.config.hereKey!,transportMode:'car',routingMode:'fast',
      origin:`${origin.latitude},${origin.longitude}`,destination:`${destination.latitude},${destination.longitude}`,
      return:'summary,travelSummary',alternatives:'2','avoid[features]':r.allowFerries ? 'dirtRoad' : 'ferry,carShuttleTrain,dirtRoad',
    }).toString();
    const data=await this.json(url,signal);
    const notice=z.object({code:z.string(),severity:z.string().optional()}).passthrough();
    const parsed=z.object({notices:z.array(notice).optional(),routes:z.array(z.object({notices:z.array(notice).optional(),sections:z.array(z.object({
      summary:summarySchema,travelSummary:summarySchema.optional(),notices:z.array(notice).optional(),transport:z.object({mode:z.string(),name:z.string().optional()}),
    })).min(1)}))}).safeParse(data);
    if(!parsed.success)throw new AppError(502,'HERE 路线数据格式异常，无法可靠计算距离与时效');
    const response=parsed.data;
    for(const route of response.routes){
      const notices=[...(response.notices ?? []),...(route.notices ?? []),...route.sections.flatMap(s=>s.notices ?? [])];
      if(notices.some(n=>n.severity==='critical'||/^violated/.test(n.code)))continue;
      const segments:RoadSegment[]=[];let usable=true;
      for(const s of route.sections){
        const mode=s.transport.mode;
        const kind=mode==='car' ? 'road' : mode==='ferry' ? 'ferry' : mode==='carShuttleTrain' ? 'railFerry' : undefined;
        if(!kind || (!r.allowFerries && kind!=='road')){usable=false;break;}
        const travel=s.travelSummary ?? s.summary;
        if(travel.duration>s.summary.duration || travel.length>s.summary.length){usable=false;break;}
        segments.push(segment(kind,kind==='road' ? '公路' : (s.transport.name ?? (kind==='ferry' ? '轮渡' : '车辆摆渡列车')),travel.length,travel.duration));
        const other=s.summary.duration-travel.duration;
        if(other>0)segments.push(segment('waiting','接口计入的登乘 / 等待',0,other));
      }
      if(!usable||!segments.some(s=>s.distanceMeters>0)||!segments.some(s=>s.durationSeconds>0))continue;
      return {segments:compact(segments),warnings:[...new Set(notices.map(n=>`路线服务提示：${n.code}`))]};
    }
    throw noRoute();
  }
  async query(body:unknown,geography:Pick<Geography,'get'>,database?:Sql):Promise<RoadResult>{
    const r=roadRequestSchema.parse(body),origin=geography.get(r.originCityId),destination=geography.get(r.destinationCityId);
    if(!origin||origin.country!==r.originCountry||!destination||destination.country!==r.destinationCountry)throw new AppError(400,'城市与国家不匹配，请重新从候选城市选择');
    const domestic=r.originCountry==='CN'&&r.destinationCountry==='CN';
    const overseas=(r.originCountry==='US'&&r.destinationCountry==='US') || (europeanCountries.has(r.originCountry)&&europeanCountries.has(r.destinationCountry));
    if(!domestic&&!overseas)throw new AppError(422,'当前预设覆盖中国大陆境内、美国境内及欧洲区域；中国跨境等路线需指定口岸并分段核实');
    const provider=domestic ? 'amap' : 'here';
    // Keys identify routing facts, never API credentials or ETA-only parameters.
    // Retain direction, coordinates and a routing-version marker to prevent unsafe reuse.
    const point=(city:GeoCity)=>({id:city.id,country:city.country,latitude:city.latitude,longitude:city.longitude});
    const descriptor={version:'ordinary-driving-v1',provider,origin:point(origin),destination:point(destination),allowFerries:r.allowFerries};
    const cacheKey=createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
    let route:RoadRoute,queriedAt:string,cached=false;
    const rows=database ? await database.query('SELECT route_payload,queried_at FROM road_routes WHERE cache_key=?',[cacheKey]) : [];
    if(rows.length){
      try{route=storedRouteSchema.parse(JSON.parse(rows[0].route_payload));queriedAt=z.iso.datetime().parse(rows[0].queried_at);}
      catch{throw new AppError(503,'数据库中该路线记录不完整，请联系维护人员检查；本次未调用外部 API');}
      cached=true;
    }else{
      let inFlight=this.directInFlight;
      if(database){if(!this.databaseInFlight.has(database))this.databaseInFlight.set(database,new Map());inFlight=this.databaseInFlight.get(database)!;}
      const existing=inFlight.get(cacheKey);
      if(existing){({route,queriedAt}=await existing);cached=!!database;}
      else{
        if(!this.config[provider==='amap'?'amapKey':'hereKey'])throw new AppError(503,`${provider==='amap'?'高德普通驾车':'HERE 普通驾车'}尚未配置，请在服务器设置 ${provider==='amap'?'AMAP_WEB_SERVICE_KEY':'HERE_ROUTING_KEY'}；请勿将密钥填入聊天或提交 GitHub`);
        if(this.active>=4)throw new AppError(429,'当前陆运查询较多，请稍后重试');
        const fetchAndSave=async()=>{
          this.active++;
          try{
            const signal=AbortSignal.timeout(this.config.timeoutMs);
            const fetched=await (provider==='amap'?this.amap(r,origin,destination,signal):this.here(r,origin,destination,signal));
            const timestamp=new Date().toISOString();
            if(database){
              try{await database.query('INSERT INTO road_routes(cache_key,provider,request_payload,route_payload,queried_at) VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO NOTHING',[cacheKey,provider,JSON.stringify(descriptor),JSON.stringify(fetched),timestamp]);}
              catch{throw new AppError(503,'路线 API 查询成功，但保存数据库失败，请联系维护人员检查');}
            }
            return {route:fetched,queriedAt:timestamp};
          }finally{this.active--;}
        };
        const pending=fetchAndSave();inFlight.set(cacheKey,pending);
        try{({route,queriedAt}=await pending);}finally{inFlight.delete(cacheKey);}
      }
    }
    const sum=(key:'distanceMeters'|'durationSeconds',roadOnly=false)=>route.segments.filter(s=>!roadOnly||s.kind==='road').reduce((n,s)=>n+s[key],0);
    const additionalHours=(r.loadingHours ?? 0)+(r.waitingHours ?? 0)+(r.borderHours ?? 0);
    const mapDrivingHours=sum('durationSeconds',true)/3600,providerHours=sum('durationSeconds')/3600;
    const truckSegments=route.segments.map(s=>s.kind==='road'?{...s,durationSeconds:Math.max(s.durationSeconds,s.distanceMeters/1000/r.averageSpeedKph*3600)}:s);
    const drivingHours=truckSegments.filter(s=>s.kind==='road').reduce((n,s)=>n+s.durationSeconds,0)/3600;
    const warnings=[...route.warnings,
      ...(cached ? ['本次使用数据库历史路线，未调用路线 API；里程与地图驾车耗时基于原查询日期，不代表实时路况。'] : []),
      '普通驾车参考路线，不校验货车限高、限重、限行或危险品和大件通行条件；不作为实际货车导航或通行许可。',
      `卡车参考驾驶耗时按公路里程 ÷ ${r.averageSpeedKph} km/h 测算，并取不低于地图驾车耗时的值；属于业务估算。`,
      '按城市参考坐标计算普通道路路线，具体仓库地址可能改变里程和耗时；结果不保证送达。',
      '驾驶耗时基于查询时的数据；可选出发时间只用于推算到达时间，不预测未来路况和时段限行。',
      '单驾 / 双驾为每天累计驾驶窗口的业务测算，不代表当地驾驶法规；额外耗时单独累加，不抵扣休息。',
      ...(r.loadingHours===null ? ['装卸耗时未计入。'] : []),...(r.waitingHours===null ? ['等待耗时未计入。'] : []),
      ...(r.originCountry!==r.destinationCountry&&r.borderHours===null ? ['跨境通关及边境等待未计入。'] : []),
      ...(route.segments.some(s=>s.kind==='ferry'||s.kind==='railFerry') ? ['路线含轮渡或摆渡，班次、可载车辆和额外等候须另行确认。'] : []),
    ];
    return {provider,providerName:provider==='amap'?'高德普通驾车':'HERE 普通驾车',sourceUrl:urls[provider],queriedAt,cached,resultSource:cached?'database':'api',routingMode:'car',origin,destination,request:r,segments:route.segments,roadNames:route.roadNames,
      roadKm:sum('distanceMeters',true)/1000,totalKm:sum('distanceMeters')/1000,drivingHours,mapDrivingHours,transferHours:providerHours-mapDrivingHours,providerHours,additionalHours,
      single:estimateRoadTime(truckSegments,r.singleDailyHours,additionalHours,r.departureAt),dual:estimateRoadTime(truckSegments,r.dualDailyHours,additionalHours,r.departureAt),warnings};
  }
}
