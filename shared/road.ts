import { z } from 'zod';
import { countryCode, type GeoCity } from './geography.js';

const country = z.string().transform(v => countryCode(v) ?? '').pipe(z.string().length(2, '请选择有效国家'));
const cityId = z.string().regex(/^\d+$/, '请从城市列表选择地点');
export const truckSchema = z.object({
  lengthM: z.number().min(1).max(50), widthM: z.number().min(1).max(10), heightM: z.number().min(1).max(10),
  currentWeightT: z.number().positive().max(100), grossWeightT: z.number().positive().max(100),
  loadCapacityT: z.number().positive().max(99), axles: z.number().int().min(2).max(12),
  size: z.enum(['1','2','3','4']), confirmed: z.boolean(),
  plateProvince: z.string().regex(/^[\u4e00-\u9fff]?$/).default(''),
  plateNumber: z.string().regex(/^([A-Z0-9]{6,7})?$/).default(''),
}).superRefine((v,ctx) => {
  if(v.currentWeightT > v.grossWeightT)ctx.addIssue({code:'custom',path:['currentWeightT'],message:'实际车货总重不能超过核定总质量'});
  if(v.loadCapacityT >= v.grossWeightT)ctx.addIssue({code:'custom',path:['loadCapacityT'],message:'核定载重须小于核定总质量（还需计入车辆自重）'});
  if(!!v.plateProvince !== !!v.plateNumber)ctx.addIssue({code:'custom',path:['plateNumber'],message:'车牌省份及其余号码须同时填写或同时留空'});
});
export type Truck = z.infer<typeof truckSchema>;
export const truckTemplates: {id:string;name:string;vehicle:Truck}[] = [
  {id:'standard',name:'普通重型货车 · 测算模板',vehicle:{lengthM:9.6,widthM:2.5,heightM:3.8,currentWeightT:18,grossWeightT:25,loadCapacityT:15,axles:3,size:'4',confirmed:false,plateProvince:'',plateNumber:''}},
  {id:'light',name:'轻型货车 · 测算模板',vehicle:{lengthM:5.9,widthM:2.2,heightM:3,currentWeightT:3.5,grossWeightT:4.49,loadCapacityT:2,axles:2,size:'2',confirmed:false,plateProvince:'',plateNumber:''}},
];
export const roadRequestSchema = z.object({
  originCountry:country,originCityId:cityId,destinationCountry:country,destinationCityId:cityId,
  vehicle:truckSchema.default(truckTemplates[0].vehicle),
  singleDailyHours:z.number().min(1).max(12).default(8),dualDailyHours:z.number().min(1).max(24).default(16),
  averageSpeedKph:z.number().min(10).max(100).default(60),
  loadingHours:z.number().min(0).max(720).nullable().default(null),
  waitingHours:z.number().min(0).max(720).nullable().default(null),
  borderHours:z.number().min(0).max(720).nullable().default(null),
  allowFerries:z.boolean().default(false),cargoType:z.enum(['general','hazardous','oversized']).default('general'),
  departureAt:z.iso.datetime().optional(),
}).superRefine((v,ctx)=>{
  if(v.originCityId===v.destinationCityId)ctx.addIssue({code:'custom',path:['destinationCityId'],message:'起运城市和目的城市不能相同'});
  if(v.dualDailyHours<v.singleDailyHours)ctx.addIssue({code:'custom',path:['dualDailyHours'],message:'双驾每天累计驾驶时间不能少于单驾'});
});
export type RoadRequest=z.infer<typeof roadRequestSchema>;
export type RoadSegment={kind:'road'|'ferry'|'railFerry'|'waiting';name:string;distanceMeters:number;durationSeconds:number};
export type RoadRoute={segments:RoadSegment[];warnings:string[];roadNames?:string[]};
export type RoadEstimate={hours:number;days:number;restHours:number;arrivalAt?:string};
export type RoadResult={
  provider:'amap'|'here';providerName:string;sourceUrl:string;queriedAt:string;cached:boolean;resultSource:'api'|'database';
  origin:GeoCity;destination:GeoCity;request:RoadRequest;segments:RoadSegment[];
  roadKm:number;totalKm:number;drivingHours:number;mapDrivingHours:number;transferHours:number;providerHours:number;additionalHours:number;routingMode:'car';roadNames?:string[];
  single:RoadEstimate;dual:RoadEstimate;warnings:string[];
};
export type RoadStatus={providers:{id:'amap'|'here';name:string;configured:boolean;region:string;setupUrl:string}[];storage:'database'};

// Fixed operating windows begin at first departure: drive up to N hours, rest until
// the next 24-hour window. Ferry time advances the clock; it isn't driving time.
// Manual additions are appended without overlapping rest, as a planning estimate.
export function estimateRoadTime(segments:RoadSegment[],dailyHours:number,additionalHours=0,departureAt?:string):RoadEstimate {
  if(!Number.isFinite(dailyHours)||dailyHours<=0||dailyHours>24)throw new Error('每天累计驾驶时间必须在 0 至 24 小时之间');
  let elapsed=0,rest=0;
  for(const segment of segments){
    let remaining=segment.durationSeconds/3600;
    if(!Number.isFinite(remaining)||remaining<0)throw new Error('无效路线耗时');
    if(segment.kind!=='road'){elapsed+=remaining;continue;}
    if(remaining<=1e-9)continue;
    const phase=elapsed%24;
    if(phase>=dailyHours-1e-9){const pause=24-phase;elapsed+=pause;rest+=pause;}
    const first=Math.min(remaining,dailyHours-elapsed%24);
    elapsed+=first;remaining-=first;
    // Skip complete windows arithmetically, so even an extreme upstream duration
    // cannot hold the server in a loop proportional to the number of days.
    if(remaining>1e-9){const pauses=Math.ceil(remaining/dailyHours-1e-12)*(24-dailyHours);elapsed+=remaining+pauses;rest+=pauses;}
  }
  if(!Number.isFinite(additionalHours)||additionalHours<0)throw new Error('无效额外耗时');
  const hours=elapsed+additionalHours;
  return {hours,days:hours/24,restHours:rest,...(departureAt ? {arrivalAt:new Date(Date.parse(departureAt)+hours*3600000).toISOString()} : {})};
}
