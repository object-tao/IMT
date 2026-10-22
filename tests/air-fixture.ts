import { airportSchema,airportNode,emptyCatalog,laneSchema,flightSchema,requestSchema } from '../shared/model.js';

// Fictional supplier and flight records. Airport identifiers are public master data.
export function airFixture(){
  const c=emptyCatalog();c.suppliers=[{id:'air-test-supplier',version:1,name:'虚构航空测试供应商',contact:'',notes:''}];
  c.airports=[airportSchema.parse({id:'test-ctu',name:'成都双流国际机场',nameEn:'Chengdu Shuangliu International Airport',iata:'CTU',country:'CN',city:'成都',cityId:'1815286',timeZone:'Asia/Shanghai',aliases:['成都双流']}),airportSchema.parse({id:'test-prg',name:'布拉格瓦茨拉夫·哈维尔机场',nameEn:'Václav Havel Airport Prague',iata:'PRG',country:'CZ',city:'Prague',cityId:'3067696',timeZone:'Europe/Prague',aliases:['布拉格']})];
  c.nodes=c.airports.map(airportNode);
  c.nodes.push({id:'test-origin',version:1,name:'成都覆盖点',country:'CN',city:'成都',cityId:'1815286',type:'city',timeZone:'Asia/Shanghai'},{id:'test-destination',version:1,name:'Prague覆盖点',country:'CZ',city:'Prague',cityId:'3067696',type:'city',timeZone:'Europe/Prague'});
  c.lanes=[laneSchema.parse({id:'air-test-lane',name:'虚构 CTU—PRG 航线',supplierId:c.suppliers[0].id,from:'test-ctu',to:'test-prg',fromAirportId:'test-ctu',toAirportId:'test-prg',mode:'air',onDemand:false,validFrom:'2026-01-01',validTo:'2026-12-31'})];
  for(const [id,from,to] of [['test-pickup','test-origin','test-ctu'],['test-delivery','test-prg','test-destination']])c.lanes.push(laneSchema.parse({id,name:id,supplierId:c.suppliers[0].id,from,to,mode:'road',transitHours:1,onDemand:true,validFrom:'2026-01-01',validTo:'2026-12-31'}));
  const request=requestSchema.parse({originCountry:'CN',originCity:'成都',originCityId:'1815286',destinationCountry:'CZ',destinationCity:'Prague',destinationCityId:'3067696',readyAt:'2026-10-22T00:00:00Z',cargo:[{name:'虚构测试货物',pieces:1,weightKg:10,lengthCm:10,widthCm:10,heightCm:10}]});
  const flight=flightSchema.parse({id:'test-flight-a',laneId:'air-test-lane',flightNumber:'XX 1234',kind:'weekly',validFrom:'2026-10-01',validTo:'2026-10-31',weekdays:[1,3,5],timeZone:'Asia/Shanghai',offBlockTime:'03:00',takeoffTime:'03:20',landingTime:'13:00',onBlockTime:'13:15',status:'confirmed',cutoffHours:2,source:'虚构测试资料'});
  return {catalog:c,request,flight,path:['test-pickup',`flight|air-test-lane|${flight.id}`,'test-delivery']};
}
export const importRows=[['航线','航班号','航站','撤轮时间','起飞时间','落地时间','挡轮时间','航站','班期','执行日期','执飞机型'],['测试航线','XX 1234','成都双流','03:00','03:20','13:00','13:15','布拉格',1,'10月1-25日','TEST-F (TEST-REG)'],['测试航线','XX 1234','CTU','04:00','04:20','14:00','14:15','PRG',3,'10月1-25日','TEST-F (TEST-REG)'],['测试航线','XX 1234','CTU','05:00','05:20','15:00','15:15','PRG',1,'10月26日','TEST-F (TEST-REG)']];
export const importOptions={supplierId:'air-test-supplier',year:2026,month:10,timeZone:'Asia/Shanghai',source:'fictional-air-schedule.xlsx'};
