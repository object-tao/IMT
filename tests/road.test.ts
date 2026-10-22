import { describe,it,expect,vi } from 'vitest';
import { RoadService } from '../server/road.js';
import { estimateRoadTime,roadRequestSchema,truckTemplates,type RoadRequest,type RoadSegment } from '../shared/road.js';
import type { GeoCity } from '../shared/geography.js';
import { createApp } from '../server/app.js';
import { Database } from '../server/database.js';
import { mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { resolve,join,sep } from 'node:path';

const cities:Record<string,GeoCity>={
  '1':{id:'1',country:'CN',name:'Shanghai',nameEn:'Shanghai',admin1:'Shanghai',latitude:31.22,longitude:121.46,timeZone:'Asia/Shanghai',population:1},
  '2':{id:'2',country:'CN',name:'Chengdu',nameEn:'Chengdu',admin1:'Sichuan',latitude:30.66,longitude:104.06,timeZone:'Asia/Shanghai',population:1},
  '3':{id:'3',country:'US',name:'New York',nameEn:'New York',admin1:'NY',latitude:40.71,longitude:-74,timeZone:'America/New_York',population:1},
  '4':{id:'4',country:'US',name:'Los Angeles',nameEn:'Los Angeles',admin1:'CA',latitude:34.05,longitude:-118.24,timeZone:'America/Los_Angeles',population:1},
  '5':{id:'5',country:'GB',name:'London',nameEn:'London',admin1:'England',latitude:51.5,longitude:-.12,timeZone:'Europe/London',population:1},
  '6':{id:'6',country:'FR',name:'Paris',nameEn:'Paris',admin1:'Paris',latitude:48.85,longitude:2.35,timeZone:'Europe/Paris',population:1},
};
const geo={get:(id:string)=>cities[id]};
const request=(patch:Partial<RoadRequest>={}):RoadRequest=>roadRequestSchema.parse({originCountry:'CN',originCityId:'1',destinationCountry:'CN',destinationCityId:'2',averageSpeedKph:100,...patch});
const road=(hours:number):RoadSegment=>({kind:'road',name:'公路',distanceMeters:hours*80000,durationSeconds:hours*3600});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const hereBody=(sections:any[],extra:object={})=>({routes:[{sections}],...extra});
const hereSection=(hours=18,mode='car',notices:any[]=[])=>({summary:{length:1800000,duration:hours*3600},transport:{mode},notices});
const us=()=>request({originCountry:'US',originCityId:'3',destinationCountry:'US',destinationCityId:'4'});
const europe=(allowFerries=false)=>request({originCountry:'GB',originCityId:'5',destinationCountry:'FR',destinationCityId:'6',allowFerries});
function amapFetch(path:any={distance:'1800000',duration:'64800',restriction:'0',steps:[{distance:'1800000',duration:'64800',instruction:'沿公路行驶'}]}){
  return vi.fn<typeof fetch>().mockResolvedValueOnce(json({status:'1',locations:'121.464000,31.224000;104.064000,30.664000'})).mockResolvedValueOnce(json({status:'1',infocode:'10000',route:{paths:[{distance:path.distance,cost:{duration:path.duration},restriction:path.restriction,steps:path.steps.map((step:any)=>({step_distance:step.distance,cost:{duration:step.duration},instruction:step.instruction,road_name:step.road ?? 'G50沪渝高速',navi:{action:step.action,assistant_action:step.assistant_action}}))}]}}));
}

describe('陆运驾驶窗口与时效',()=>{
  it('短途到达后不追加整天休息，整 8 小时不多算一个休息日',()=>{
    expect(estimateRoadTime([road(3)],8).hours).toBe(3);expect(estimateRoadTime([road(8)],8).hours).toBe(8);
    expect(estimateRoadTime([road(8.5)],8).hours).toBe(24.5);expect(estimateRoadTime([road(16)],8).hours).toBe(32);
    expect(estimateRoadTime([road(18)],8).hours).toBe(50);expect(estimateRoadTime([road(18)],16).hours).toBe(26);
    expect(estimateRoadTime([road(48)],24).hours).toBe(48);
  });
  it('摆渡耗时不当成驾驶；手动时间单列并推算到达时间',()=>{
    const ferry:RoadSegment={kind:'ferry',name:'轮渡',distanceMeters:10000,durationSeconds:10*3600};
    const result=estimateRoadTime([road(8),ferry,road(2)],8,3,'2026-10-22T00:00:00Z');
    expect(result.hours).toBe(29);expect(result.restHours).toBe(6);expect(result.arrivalAt).toBe('2026-10-23T05:00:00.000Z');
  });
  it('拒绝异常车型、重量、出发时间、城市及驾驶参数，保留未知时间与零的区别',()=>{
    expect(request().borderHours).toBeNull();expect(request({borderHours:0}).borderHours).toBe(0);
    for(const patch of [{originCityId:'2'},{singleDailyHours:0},{singleDailyHours:10,dualDailyHours:8},{loadingHours:-1},{departureAt:'tomorrow'},
      {vehicle:{...truckTemplates[0].vehicle,currentWeightT:30}},{vehicle:{...truckTemplates[0].vehicle,loadCapacityT:26}},
      {vehicle:{...truckTemplates[0].vehicle,plateProvince:'川'}}])expect(roadRequestSchema.safeParse({...request(),...patch}).success).toBe(false);
  });
});

const databaseDrivers=['sqlite',...(process.env.TEST_DATABASE_URL ? ['postgresql'] : [])];
describe.each(databaseDrivers)('陆运数据库复用：%s',driver=>{
  const database=(file=':memory:')=>new Database(driver==='postgresql' ? {url:process.env.TEST_DATABASE_URL} : {file});
  it('成功记录落库，重开数据库和服务后仍读取原记录，不需要 Key；计时条件重新计算',async()=>{
    const root=resolve('.local');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'road-test-'));
    let db=database(join(directory,'routes.sqlite'));await db.initialize();await db.query('DELETE FROM road_routes');
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>json(hereBody([hereSection()])));
    try{
      const first=await new RoadService({hereKey:'private-test-key',fetch:fetcher}).query(us(),geo,db);
      expect(first.resultSource).toBe('api');expect(first.cached).toBe(false);
      const rows=await db.query('SELECT * FROM road_routes');expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toContain('private-test-key');
      await db.close();db=database(join(directory,'routes.sqlite'));await db.initialize();
      const noFetch=vi.fn<typeof fetch>();
      const second=await new RoadService({hereKey:'',fetch:noFetch}).query({...us(),singleDailyHours:4,dualDailyHours:20,loadingHours:5,departureAt:'2026-10-22T00:00:00Z',vehicle:{...us().vehicle,confirmed:true}},geo,db);
      expect(second.resultSource).toBe('database');expect(second.cached).toBe(true);expect(second.queriedAt).toBe(first.queriedAt);expect(second.roadKm).toBe(first.roadKm);
      expect(second.single.hours).toBe(103);expect(second.dual.hours).toBe(23);expect(second.dual.arrivalAt).toBe('2026-10-22T23:00:00.000Z');
      expect(second.warnings.join('')).toContain('数据库历史路线');expect(second.warnings.join('')).not.toContain('尚未按实际车辆确认');expect(noFetch).not.toHaveBeenCalled();
      const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+400*86400000);
      try{expect((await new RoadService({hereKey:'',fetch:noFetch}).query(us(),geo,db)).resultSource).toBe('database');}finally{clock.mockRestore();}
      expect(noFetch).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
      const slower=await new RoadService({hereKey:'',fetch:noFetch}).query({...us(),averageSpeedKph:60},geo,db);
      expect(slower.resultSource).toBe('database');expect(slower.mapDrivingHours).toBe(18);expect(slower.drivingHours).toBe(30);expect(slower.single.hours).toBe(78);expect(slower.dual.hours).toBe(38);expect(noFetch).not.toHaveBeenCalled();
    }finally{await db.query('DELETE FROM road_routes');await db.close();if(!directory.startsWith(root+sep))throw new Error('Unexpected test directory');rmSync(directory,{recursive:true,force:true});}
  });
  it('方向、摆渡设置及城市坐标不同不复用；车辆参数不影响普通路线',async()=>{
    const db=database();await db.initialize();await db.query('DELETE FROM road_routes');
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>json(hereBody([hereSection()]))),service=new RoadService({hereKey:'key',fetch:fetcher});
    try{
      const requests=[us(),{...us(),originCityId:'4',destinationCityId:'3'},{...us(),allowFerries:true}];
      for(const r of requests){expect((await service.query(r,geo,db)).cached).toBe(false);expect((await service.query(r,geo,db)).cached).toBe(true);}
      const movedGeo={get:(id:string)=>id==='3' ? {...cities[id],longitude:-74.1} : cities[id]};
      expect((await service.query(us(),movedGeo,db)).cached).toBe(false);
      expect((await service.query({...us(),vehicle:{...us().vehicle,heightM:4}},geo,db)).cached).toBe(true);expect(fetcher).toHaveBeenCalledTimes(4);expect(await db.query('SELECT * FROM road_routes')).toHaveLength(4);
    }finally{await db.query('DELETE FROM road_routes');await db.close();}
  });
  it('同一服务同时查询相同条件只调用一次，失败不落库且可以重试',async()=>{
    const db=database();await db.initialize();await db.query('DELETE FROM road_routes');
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({},403));
    const service=new RoadService({hereKey:'key',fetch:fetcher});
    try{
      await expect(service.query(us(),geo,db)).rejects.toThrow('授权失败');expect(await db.query('SELECT * FROM road_routes')).toHaveLength(0);
      let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});fetcher.mockImplementation(async()=>{await gate;return json(hereBody([hereSection()]));});
      const requests=Array.from({length:8},()=>service.query(us(),geo,db));release();
      const results=await Promise.all(requests);expect(results.every(r=>r.roadKm===1800)).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);expect(await db.query('SELECT * FROM road_routes')).toHaveLength(1);
    }finally{await db.query('DELETE FROM road_routes');await db.close();}
  });
  it('已有记录损坏时明确报错，不静默调用 API',async()=>{
    const db=database();await db.initialize();await db.query('DELETE FROM road_routes');
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(json(hereBody([hereSection()]))),service=new RoadService({hereKey:'key',fetch:fetcher});
    try{
      await service.query(us(),geo,db);await db.query('UPDATE road_routes SET route_payload=?',['{invalid']);
      await expect(service.query(us(),geo,db)).rejects.toThrow('本次未调用外部 API');expect(fetcher).toHaveBeenCalledTimes(1);
    }finally{await db.query('DELETE FROM road_routes');await db.close();}
  });
});

describe('真实路线适配与异常隔离（固定接口响应，不调用付费服务）',()=>{
  it('国内先转换 WGS84，使用普通驾车接口和轮渡开关，不发送货车参数',async()=>{
    const fetcher=amapFetch(),service=new RoadService({amapKey:'secret-amap',fetch:fetcher});
    const result=await service.query(request({loadingHours:2}),geo);
    const convert=new URL(String(fetcher.mock.calls[0][0])),route=new URL(String(fetcher.mock.calls[1][0]));
    expect(convert.searchParams.get('coordsys')).toBe('gps');expect(convert.searchParams.get('locations')).toBe('121.460000,31.220000|104.060000,30.660000');
    expect(route.searchParams.get('origin')).toBe('121.464000,31.224000');expect(route.hostname).toBe('restapi.amap.com');expect(route.pathname).toBe('/v5/direction/driving');
    expect(route.searchParams.get('ferry')).toBe('1');expect(route.searchParams.get('show_fields')).toContain('cost');expect(route.searchParams.get('strategy')).toBe('32');
    expect(route.searchParams.has('load')).toBe(false);expect(route.searchParams.has('size')).toBe(false);
    expect(result.roadKm).toBe(1800);expect(result.drivingHours).toBe(18);expect(result.single.hours).toBe(52);expect(result.dual.hours).toBe(28);
    expect(result.warnings.join('')).toContain('普通驾车参考路线');expect(result.mapDrivingHours).toBe(18);expect(JSON.stringify(result)).not.toContain('secret-amap');
  });
  it('HERE 采用普通驾车模式，不发送车辆尺寸或重量，并默认避让摆渡',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(json(hereBody([hereSection()]))),service=new RoadService({hereKey:'secret-here',fetch:fetcher});
    const result=await service.query(us(),geo),url=new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('transportMode')).toBe('car');expect([...url.searchParams.keys()].some(key=>key.startsWith('vehicle['))).toBe(false);
    expect(url.searchParams.get('avoid[features]')).toContain('carShuttleTrain');expect(result.roadKm).toBe(1800);
  });
  it('卡车耗时不低于地图拥堵耗时，并明确提示普通路线不作货车适运校验',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(json(hereBody([hereSection(36,'car')])));
    const result=await new RoadService({hereKey:'key',fetch:fetcher}).query({...us(),averageSpeedKph:60,cargoType:'hazardous'},geo);
    expect(result.mapDrivingHours).toBe(36);expect(result.drivingHours).toBe(36);expect(result.routingMode).toBe('car');expect(result.warnings.join('')).toContain('不校验货车限高');
  });
  it('阻止未配置、国家错配及不支持的跨境；不调用外部接口',async()=>{
    const fetcher=vi.fn<typeof fetch>(),service=new RoadService({amapKey:'',hereKey:'',fetch:fetcher});
    await expect(service.query(request(),geo)).rejects.toThrow('AMAP_WEB_SERVICE_KEY');
    await expect(service.query(request({originCountry:'US'}),geo)).rejects.toThrow('城市与国家');
    await expect(service.query(request({destinationCountry:'GB',destinationCityId:'5'}),geo)).rejects.toThrow('口岸');
    expect(fetcher).not.toHaveBeenCalled();expect(JSON.stringify(service.status())).not.toContain('secret');
  });
  it('HERE 关键警告、未知关键警告及无路线均不得显示为可用路线',async()=>{
    for(const body of [hereBody([hereSection(18,'truck',[{severity:'critical',code:'newUnknownCode'}])]),
      hereBody([hereSection(18,'truck',[{severity:'info',code:'violatedVehicleRestriction'}])]),
      hereBody([hereSection()],{notices:[{severity:'critical',code:'blockedRoad'}]}),{routes:[]}]){
      const service=new RoadService({hereKey:'key',fetch:vi.fn<typeof fetch>().mockResolvedValue(json(body))});
      await expect(service.query(us(),geo)).rejects.toThrow('未找到');
    }
  });
  it('拒绝 Amap 限行路线、缺少分段或分段数据不完整的结果',async()=>{
    for(const patch of [{restriction:2},{steps:[]},{steps:[{distance:'1',duration:'1'}]}]){
      const fetcher=amapFetch({distance:'1800000',duration:'64800',steps:[{distance:'1800000',duration:'64800'}],...patch});
      await expect(new RoadService({amapKey:'key',fetch:fetcher}).query(request(),geo)).rejects.toThrow('未找到');
    }
  });
  it('HERE 即使避让参数被上游忽略也拒绝轮渡，允许后单独拆分里程和耗时',async()=>{
    const sections=[{summary:{length:100000,duration:7200},transport:{mode:'car'}},{summary:{length:40000,duration:3600},transport:{mode:'ferry',name:'Dover-Calais'}}];
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>json(hereBody(sections))),service=new RoadService({hereKey:'key',fetch:fetcher});
    await expect(service.query(europe(),geo)).rejects.toThrow('未找到');
    const result=await service.query(europe(true),geo);expect(result.roadKm).toBe(100);expect(result.totalKm).toBe(140);expect(result.drivingHours).toBe(2);expect(result.transferHours).toBe(1);expect(result.warnings.join('')).toContain('边境等待未计入');
  });
  it('高德轮渡识别，默认拒绝，开启后独立显示',async()=>{
    const path={distance:'120000',duration:'10800',steps:[{distance:'100000',duration:'7200',instruction:'沿高速公路行驶'},{distance:'20000',duration:'3600',instruction:'乘坐轮渡'}]};
    await expect(new RoadService({amapKey:'key',fetch:amapFetch(path)}).query(request(),geo)).rejects.toThrow('未找到');
    const result=await new RoadService({amapKey:'key',fetch:amapFetch(path)}).query(request({allowFerries:true}),geo);
    expect(result.roadKm).toBe(100);expect(result.totalKm).toBe(120);expect(result.transferHours).toBe(1);
  });
  it('供应商授权、配额、网络及错误响应不泄露密钥或伪造数字',async()=>{
    for(const [status,message] of [[403,'授权失败'],[429,'额度'],[500,'暂不可用']] as const){
      await expect(new RoadService({hereKey:'secret',fetch:vi.fn<typeof fetch>().mockResolvedValue(json({},status))}).query(us(),geo)).rejects.toThrow(message);
    }
    await expect(new RoadService({hereKey:'secret',fetch:vi.fn<typeof fetch>().mockRejectedValue(new Error('https://bad/?apiKey=secret'))}).query(us(),geo)).rejects.toThrow('无法连接');
    await expect(new RoadService({hereKey:'secret',fetch:vi.fn<typeof fetch>().mockResolvedValue(json({routes:[{sections:[{}]}]}))}).query(us(),geo)).rejects.toThrow('格式异常');
  });
  it('高德 10012 返回明确服务权限提示，安全处理错误码，不输出供应商原始消息',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({status:'1',locations:'121.464,31.224;104.064,30.664'})).mockResolvedValueOnce(json({status:'0',infocode:10012,info:'INSUFFICIENT_PRIVILEGES secret-key-in-message'}));
    await expect(new RoadService({amapKey:'secret-key-in-message',fetch:fetcher}).query(request(),geo)).rejects.toThrow('高德错误码 10012');
    const bad=vi.fn<typeof fetch>().mockResolvedValue(json({status:'0',infocode:'secret-value',info:'secret-value'}));
    await expect(new RoadService({amapKey:'secret-value',fetch:bad}).query(request(),geo)).rejects.toThrow('高德坐标转换未成功：请检查服务权限、配额或参数');
  });
  it('整次查询超时生效，后续请求可继续',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,options)=>new Promise((_resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('failed')),30);options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('abort'));},{once:true});
    }));
    await expect(new RoadService({hereKey:'key',fetch:fetcher,timeoutMs:5}).query(us(),geo)).rejects.toThrow('超时');
  });
  it('接口受登录保护，配置状态不暴露密钥；缺配置返回清晰错误',async()=>{
    const {app}=await createApp({database:new Database({file:':memory:'}),password:'test-password-long-enough',secret:'test-session-secret-with-32-characters',road:new RoadService({amapKey:'',hereKey:''})});
    try{
      expect((await app.inject('/api/road/status')).statusCode).toBe(401);
      expect((await app.inject({method:'POST',url:'/api/road/query',payload:{}})).statusCode).toBe(401);
      const login=await app.inject({method:'POST',url:'/api/login',payload:{password:'test-password-long-enough'}}),cookies={imt_session:login.cookies[0].value};
      expect((await app.inject({url:'/api/road/status',cookies})).json().providers[0].configured).toBe(false);
      const missing=await app.inject({method:'POST',url:'/api/road/query',cookies,payload:request({originCityId:'1796236',destinationCityId:'1815286'})});
      expect(missing.statusCode).toBe(503);expect(missing.json().message).toContain('尚未配置');
      expect((await app.inject({method:'POST',url:'/api/road/query',cookies,payload:{}})).statusCode).toBe(400);
    }finally{await app.close();}
  });
});
