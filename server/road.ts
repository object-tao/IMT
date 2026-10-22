import { createHash } from 'node:crypto';
import { z } from 'zod';
import { roadRequestSchema,estimateRoadTime,type RoadRequest,type RoadRoute,type RoadResult,type RoadStatus,type RoadSegment } from '../shared/road.js';
import type { GeoCity } from '../shared/geography.js';
import type { Geography } from './geography.js';
import { AppError } from './store.js';

type Config={amapKey?:string;hereKey?:string;cacheTtlSeconds?:number;timeoutMs?:number;fetch?:typeof fetch};
const europeanCountries=new Set('AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH TR UA GB VA AX'.split(' '));
const urls={amap:'https://lbs.amap.com/api/logistic-service/guide/wagon_path/hc-route-plan',here:'https://docs.here.com/routing/docs/routing-v8-truck-routing'};
const metric=z.union([z.number(),z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const summarySchema=z.object({length:metric,duration:metric});
const segment=(kind:RoadSegment['kind'],name:string,distanceMeters:number,durationSeconds:number):RoadSegment=>({kind,name,distanceMeters,durationSeconds});
const noRoute=()=>new AppError(422,'未找到符合条件的货车道路路线；请检查城市参考点、车辆限制及轮渡设置，不提供直线距离替代值');
function compact(segments:RoadSegment[]):RoadSegment[]{
  const result:RoadSegment[]=[];
  for(const s of segments){const last=result.at(-1);if(last?.kind==='road' && s.kind==='road'){last.distanceMeters+=s.distanceMeters;last.durationSeconds+=s.durationSeconds;}else result.push({...s});}
  return result;
}

export class RoadService {
  private config:Required<Pick<Config,'cacheTtlSeconds'|'timeoutMs'|'fetch'>>&Config;
  private cache=new Map<string,{expires:number;route:RoadRoute;queriedAt:string}>();
  private active=0;
  constructor(config:Config={}){
    this.config={amapKey:config.amapKey ?? process.env.AMAP_TRUCK_KEY,hereKey:config.hereKey ?? process.env.HERE_ROUTING_KEY,
      cacheTtlSeconds:config.cacheTtlSeconds ?? Number(process.env.ROAD_CACHE_TTL_SECONDS ?? 0),timeoutMs:config.timeoutMs ?? 12000,fetch:config.fetch ?? fetch};
    if(!Number.isFinite(this.config.cacheTtlSeconds)||this.config.cacheTtlSeconds<0||this.config.cacheTtlSeconds>3600)throw new Error('ROAD_CACHE_TTL_SECONDS 必须为 0 至 3600');
  }
  status():RoadStatus{return {providers:[
    {id:'amap',name:'高德货车路线',configured:!!this.config.amapKey,region:'中国大陆境内',setupUrl:urls.amap},
    {id:'here',name:'HERE Truck',configured:!!this.config.hereKey,region:'美国及欧洲；以接口实际覆盖为准',setupUrl:urls.here},
  ],cacheTtlSeconds:this.config.cacheTtlSeconds};}
  private async json(url:URL,signal:AbortSignal):Promise<any>{
    // Do not log URLs, upstream payloads or raw fetch exceptions: API keys are query parameters.
    try{
      const response=await this.config.fetch(url,{signal,redirect:'error'});
      if(response.status===401||response.status===403)throw new AppError(503,'路线服务授权失败，请检查 API Key 及货车服务开通权限');
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
    if(String(coords.status)!=='1')throw new AppError(503,'高德坐标转换未成功，请检查 Web 服务 Key、配额及访问权限');
    const locations=String(coords.locations ?? '').split(';');
    if(locations.length!==2 || !locations.every(p=>/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p)))throw new AppError(502,'高德坐标转换返回格式异常');
    const v=r.vehicle,url=new URL('https://tsapi.amap.com/v1/logistics/transport/route/direction/truck');
    url.search=new URLSearchParams({key,origin:locations[0],destination:locations[1],size:v.size,height:String(v.heightM),width:String(v.widthM),
      length:String(v.lengthM),load:String(v.grossWeightT),weight:String(v.loadCapacityT),axis:String(v.axles),strategy:'11',nosteps:'0',showpolyline:'0',
      avoid_ferry:r.allowFerries ? '0' : '1',restriction:'1',consider_load:'0',
      ...(v.plateProvince ? {province:v.plateProvince,number:v.plateNumber} : {})}).toString();
    const data=await this.json(url,signal);
    if(!data || typeof data!=='object')throw new AppError(502,'高德路线数据格式异常');
    if(String(data.errcode)!=='10000')throw new AppError(503,'高德货车查询未成功，请检查物流高级货车服务权限、配额或车辆参数');
    const pathSchema=z.object({distance:metric.refine(v=>v>0),duration:metric.refine(v=>v>0),restriction:z.coerce.number().optional(),steps:z.array(z.object({
      distance:metric,duration:metric,instruction:z.string().optional(),road:z.string().optional(),action:z.string().optional(),assistant_action:z.string().optional(),
    })).min(1)});
    const paths=data.data?.route?.paths ?? data.route?.paths;
    if(!Array.isArray(paths)||!paths.length)throw noRoute();
    for(const raw of paths){
      const parsed=pathSchema.safeParse(raw);if(!parsed.success)continue;const p=parsed.data;
      if(p.restriction!==undefined && p.restriction>=2)continue;
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
      return {segments:compact(steps),warnings:[
        '高德高级版按车型、长宽高、核定总质量及核定载重处理；实际车货总重不作为独立约束传入，需复核实际通行条件。',
        ...(!v.plateProvince ? ['未填写车牌，未按车牌核查政策限行。'] : []),
        ...(p.restriction===undefined||p.restriction===0 ? ['接口未完整确认政策限行，实际运输前需复核。'] : []),
      ]};
    }
    throw noRoute();
  }
  private async here(r:RoadRequest,origin:GeoCity,destination:GeoCity,signal:AbortSignal):Promise<RoadRoute>{
    const v=r.vehicle,url=new URL('https://router.hereapi.com/v8/routes');
    url.search=new URLSearchParams({apiKey:this.config.hereKey!,transportMode:'truck',routingMode:'fast',
      origin:`${origin.latitude},${origin.longitude}`,destination:`${destination.latitude},${destination.longitude}`,
      return:'summary,travelSummary',alternatives:'2','avoid[features]':r.allowFerries ? 'dirtRoad' : 'ferry,carShuttleTrain,dirtRoad',
      'vehicle[height]':String(Math.ceil(v.heightM*100)),'vehicle[width]':String(Math.ceil(v.widthM*100)),'vehicle[length]':String(Math.ceil(v.lengthM*100)),
      'vehicle[currentWeight]':String(Math.ceil(v.currentWeightT*1000)),'vehicle[grossWeight]':String(Math.ceil(v.grossWeightT*1000)),
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
        const kind=mode==='truck'||mode==='car' ? 'road' : mode==='ferry' ? 'ferry' : mode==='carShuttleTrain' ? 'railFerry' : undefined;
        if(!kind || (!r.allowFerries && kind!=='road')){usable=false;break;}
        const travel=s.travelSummary ?? s.summary;
        if(travel.duration>s.summary.duration || travel.length>s.summary.length){usable=false;break;}
        segments.push(segment(kind,kind==='road' ? '公路' : (s.transport.name ?? (kind==='ferry' ? '轮渡' : '车辆摆渡列车')),travel.length,travel.duration));
        const other=s.summary.duration-travel.duration;
        if(other>0)segments.push(segment('waiting','接口计入的登乘 / 等待',0,other));
      }
      if(!usable||!segments.some(s=>s.distanceMeters>0)||!segments.some(s=>s.durationSeconds>0))continue;
      return {segments:compact(segments),warnings:[...new Set(notices.map(n=>`路线服务提示：${n.code}`)),
        'HERE 按尺寸、实际车货总重及核定总质量查询；轴荷、排放区及特殊通行许可需另行复核。']};
    }
    throw noRoute();
  }
  async query(body:unknown,geography:Pick<Geography,'get'>):Promise<RoadResult>{
    const r=roadRequestSchema.parse(body),origin=geography.get(r.originCityId),destination=geography.get(r.destinationCityId);
    if(!origin||origin.country!==r.originCountry||!destination||destination.country!==r.destinationCountry)throw new AppError(400,'城市与国家不匹配，请重新从候选城市选择');
    if(r.cargoType!=='general')throw new AppError(422,'危险品及超限大件需专门核实许可和通行条件，本查询暂不生成普通货车测算结果');
    const domestic=r.originCountry==='CN'&&r.destinationCountry==='CN';
    const overseas=(r.originCountry==='US'&&r.destinationCountry==='US') || (europeanCountries.has(r.originCountry)&&europeanCountries.has(r.destinationCountry));
    if(!domestic&&!overseas)throw new AppError(422,'当前预设覆盖中国大陆境内、美国境内及欧洲区域；中国跨境等路线需指定口岸并分段核实');
    const provider=domestic ? 'amap' : 'here';
    if(domestic && r.vehicle.lengthM>25)throw new AppError(422,'高德货车路线支持的整车长度上限为 25 m，超长车辆需专项核实');
    if(!this.config[provider==='amap'?'amapKey':'hereKey'])throw new AppError(503,`${provider==='amap'?'高德货车':'HERE Truck'}尚未配置，请先开通服务并在服务器设置 ${provider==='amap'?'AMAP_TRUCK_KEY':'HERE_ROUTING_KEY'}；请勿将密钥填入聊天或提交 GitHub`);
    const cacheKey=createHash('sha256').update(JSON.stringify({provider,origin:origin.id,destination:destination.id,vehicle:r.vehicle,allowFerries:r.allowFerries})).digest('hex');
    const now=Date.now(),hit=this.cache.get(cacheKey);let route:RoadRoute,queriedAt:string,cached=false;
    if(hit&&hit.expires>now){({route,queriedAt}=hit);cached=true;}
    else{
      if(this.active>=4)throw new AppError(429,'当前陆运查询较多，请稍后重试');
      this.active++;
      try{const signal=AbortSignal.timeout(this.config.timeoutMs);route=await (provider==='amap'?this.amap(r,origin,destination,signal):this.here(r,origin,destination,signal));queriedAt=new Date().toISOString();}
      finally{this.active--;}
      if(this.config.cacheTtlSeconds>0){for(const [key,value] of this.cache)if(value.expires<=now)this.cache.delete(key);if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value!);this.cache.set(cacheKey,{route,queriedAt,expires:Date.now()+this.config.cacheTtlSeconds*1000});}
    }
    const sum=(key:'distanceMeters'|'durationSeconds',roadOnly=false)=>route.segments.filter(s=>!roadOnly||s.kind==='road').reduce((n,s)=>n+s[key],0);
    const additionalHours=(r.loadingHours ?? 0)+(r.waitingHours ?? 0)+(r.borderHours ?? 0);
    const drivingHours=sum('durationSeconds',true)/3600,providerHours=sum('durationSeconds')/3600;
    const warnings=[...route.warnings,
      '按城市参考坐标计算推荐货车路线，具体仓库地址可能改变里程和耗时；结果不保证送达。',
      '驾驶耗时基于查询时的数据；可选出发时间只用于推算到达时间，不预测未来路况和时段限行。',
      '单驾 / 双驾为每天累计驾驶窗口的业务测算，不代表当地驾驶法规；额外耗时单独累加，不抵扣休息。',
      ...(!r.vehicle.confirmed ? ['当前车辆参数来自测算模板，尚未按实际车辆确认。'] : []),
      ...(r.loadingHours===null ? ['装卸耗时未计入。'] : []),...(r.waitingHours===null ? ['等待耗时未计入。'] : []),
      ...(r.originCountry!==r.destinationCountry&&r.borderHours===null ? ['跨境通关及边境等待未计入。'] : []),
      ...(route.segments.some(s=>s.kind==='ferry'||s.kind==='railFerry') ? ['路线含轮渡或摆渡，班次、可载车辆和额外等候须另行确认。'] : []),
    ];
    return {provider,providerName:provider==='amap'?'高德货车路线':'HERE Truck',sourceUrl:urls[provider],queriedAt,cached,origin,destination,request:r,segments:route.segments,
      roadKm:sum('distanceMeters',true)/1000,totalKm:sum('distanceMeters')/1000,drivingHours,transferHours:providerHours-drivingHours,providerHours,additionalHours,
      single:estimateRoadTime(route.segments,r.singleDailyHours,additionalHours,r.departureAt),dual:estimateRoadTime(route.segments,r.dualDailyHours,additionalHours,r.departureAt),warnings};
  }
}
