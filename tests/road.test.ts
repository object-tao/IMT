import { describe,it,expect,vi } from 'vitest';
import { RoadService } from '../server/road.js';
import { estimateRoadTime,roadRequestSchema,truckTemplates,type RoadRequest,type RoadSegment } from '../shared/road.js';
import type { GeoCity } from '../shared/geography.js';
import { createApp } from '../server/app.js';
import { Database } from '../server/database.js';

const cities:Record<string,GeoCity>={
  '1':{id:'1',country:'CN',name:'Shanghai',nameEn:'Shanghai',admin1:'Shanghai',latitude:31.22,longitude:121.46,timeZone:'Asia/Shanghai',population:1},
  '2':{id:'2',country:'CN',name:'Chengdu',nameEn:'Chengdu',admin1:'Sichuan',latitude:30.66,longitude:104.06,timeZone:'Asia/Shanghai',population:1},
  '3':{id:'3',country:'US',name:'New York',nameEn:'New York',admin1:'NY',latitude:40.71,longitude:-74,timeZone:'America/New_York',population:1},
  '4':{id:'4',country:'US',name:'Los Angeles',nameEn:'Los Angeles',admin1:'CA',latitude:34.05,longitude:-118.24,timeZone:'America/Los_Angeles',population:1},
  '5':{id:'5',country:'GB',name:'London',nameEn:'London',admin1:'England',latitude:51.5,longitude:-.12,timeZone:'Europe/London',population:1},
  '6':{id:'6',country:'FR',name:'Paris',nameEn:'Paris',admin1:'Paris',latitude:48.85,longitude:2.35,timeZone:'Europe/Paris',population:1},
};
const geo={get:(id:string)=>cities[id]};
const request=(patch:Partial<RoadRequest>={}):RoadRequest=>roadRequestSchema.parse({originCountry:'CN',originCityId:'1',destinationCountry:'CN',destinationCityId:'2',...patch});
const road=(hours:number):RoadSegment=>({kind:'road',name:'公路',distanceMeters:hours*80000,durationSeconds:hours*3600});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const hereBody=(sections:any[],extra:object={})=>({routes:[{sections}],...extra});
const hereSection=(hours=18,mode='truck',notices:any[]=[])=>({summary:{length:1800000,duration:hours*3600},transport:{mode},notices});
const us=()=>request({originCountry:'US',originCityId:'3',destinationCountry:'US',destinationCityId:'4'});
const europe=(allowFerries=false)=>request({originCountry:'GB',originCityId:'5',destinationCountry:'FR',destinationCityId:'6',allowFerries});
function amapFetch(path:any={distance:'1800000',duration:'64800',restriction:'0',steps:[{distance:'1800000',duration:'64800',instruction:'沿公路行驶'}]}){
  return vi.fn<typeof fetch>().mockResolvedValueOnce(json({status:'1',locations:'121.464000,31.224000;104.064000,30.664000'})).mockResolvedValueOnce(json({errcode:10000,data:{route:{paths:[path]}}}));
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

describe('真实路线适配与异常隔离（固定接口响应，不调用付费服务）',()=>{
  it('国内先转换 WGS84 坐标，按货车及正确吨位字段请求；结果区分驾驶与预计时效',async()=>{
    const fetcher=amapFetch(),service=new RoadService({amapKey:'secret-amap',fetch:fetcher});
    const result=await service.query(request({loadingHours:2}),geo);
    const convert=new URL(String(fetcher.mock.calls[0][0])),route=new URL(String(fetcher.mock.calls[1][0]));
    expect(convert.searchParams.get('coordsys')).toBe('gps');expect(convert.searchParams.get('locations')).toBe('121.460000,31.220000|104.060000,30.660000');
    expect(route.searchParams.get('origin')).toBe('121.464000,31.224000');expect(route.hostname).toBe('tsapi.amap.com');expect(route.pathname).toBe('/v1/logistics/transport/route/direction/truck');
    expect(route.searchParams.get('length')).toBe('9.6');expect(route.searchParams.get('avoid_ferry')).toBe('1');expect(route.searchParams.get('consider_load')).toBe('0');
    expect(route.searchParams.get('load')).toBe('25');expect(route.searchParams.get('weight')).toBe('15');expect(route.searchParams.get('size')).toBe('4');
    expect(result.roadKm).toBe(1800);expect(result.drivingHours).toBe(18);expect(result.single.hours).toBe(52);expect(result.dual.hours).toBe(28);
    expect(result.warnings.join('')).toContain('未填写车牌');expect(result.warnings.join('')).toContain('尚未按实际车辆确认');expect(JSON.stringify(result)).not.toContain('secret-amap');
  });
  it('HERE 采用货车模式，厘米和千克单位，检查警告且默认避让摆渡',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(json(hereBody([hereSection()]))),service=new RoadService({hereKey:'secret-here',fetch:fetcher});
    const result=await service.query(us(),geo),url=new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('transportMode')).toBe('truck');expect(url.searchParams.get('vehicle[height]')).toBe('380');
    expect(url.searchParams.get('vehicle[currentWeight]')).toBe('18000');expect(url.searchParams.get('vehicle[grossWeight]')).toBe('25000');
    expect(url.searchParams.get('avoid[features]')).toContain('carShuttleTrain');expect(result.roadKm).toBe(1800);
  });
  it('阻止未配置、国家错配、不支持的跨境以及特殊货物；不调用付费接口',async()=>{
    const fetcher=vi.fn<typeof fetch>(),service=new RoadService({amapKey:'',hereKey:'',fetch:fetcher});
    await expect(service.query(request(),geo)).rejects.toThrow('AMAP_TRUCK_KEY');
    await expect(service.query(request({originCountry:'US'}),geo)).rejects.toThrow('城市与国家');
    await expect(service.query(request({destinationCountry:'GB',destinationCityId:'5'}),geo)).rejects.toThrow('口岸');
    await expect(service.query(request({cargoType:'hazardous'}),geo)).rejects.toThrow('专门核实');
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
    const sections=[{summary:{length:100000,duration:7200},transport:{mode:'truck'}},{summary:{length:40000,duration:3600},transport:{mode:'ferry',name:'Dover-Calais'}}];
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
  it('整次查询超时生效，后续请求可继续',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,options)=>new Promise((_resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('failed')),30);options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('abort'));},{once:true});
    }));
    await expect(new RoadService({hereKey:'key',fetch:fetcher,timeoutMs:5}).query(us(),geo)).rejects.toThrow('超时');
  });
  it('缓存默认关闭；启用后按车辆隔离且时效参数重新计算，过期后重新查询',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>json(hereBody([hereSection()])));
    const disabled=new RoadService({hereKey:'key',fetch:fetcher,cacheTtlSeconds:0});await disabled.query(us(),geo);await disabled.query(us(),geo);expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockClear();const service=new RoadService({hereKey:'key',fetch:fetcher,cacheTtlSeconds:60});
    const first=await service.query(us(),geo),second=await service.query({...us(),loadingHours:5},geo);
    expect(first.cached).toBe(false);expect(second.cached).toBe(true);expect(second.single.hours-first.single.hours).toBe(5);expect(fetcher).toHaveBeenCalledTimes(1);
    await service.query({...us(),vehicle:{...us().vehicle,heightM:4}},geo);expect(fetcher).toHaveBeenCalledTimes(2);
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+61000);
    try{expect((await service.query(us(),geo)).cached).toBe(false);expect(fetcher).toHaveBeenCalledTimes(3);}finally{clock.mockRestore();}
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
