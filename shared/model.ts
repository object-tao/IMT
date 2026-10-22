import { z } from 'zod';
import { countryCode, sameCity } from './geography.js';

export const modes = ['road', 'rail', 'air', 'sea', 'transfer'] as const;
export const modeNames: Record<string, string> = { road: '公路', rail: '铁路', air: '航空', sea: '海运', transfer: '接驳' };
export const cargoFlags = ['oversized', 'hazardous', 'batteryInstalled', 'batteryPacked', 'batteryOnly', 'liquid', 'temperature'] as const;
export const flagNames: Record<string, string> = { oversized: '大件', hazardous: '危险品', batteryInstalled: '内置电池', batteryPacked: '配套电池', batteryOnly: '纯电池', liquid: '液体', temperature: '温控' };
export const units = ['kg', 'chargeableKg', 'cbm', 'vehicle', 'container', 'shipment'] as const;
export const unitNames: Record<string, string> = { kg: '公斤', chargeableKg: '计费公斤', cbm: '立方米', vehicle: '车', container: '柜', shipment: '票' };
const text = z.string().trim().min(1).max(200);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const positive = z.number().finite().positive().max(1e12);
const amount = z.number().finite().nonnegative().max(1e12);
export const entityBase = z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/, 'ID 仅支持字母、数字、横线、下划线和点'), version: z.number().int().positive().default(1) });
export const supplierSchema = entityBase.extend({ name: text, contact: z.string().max(300).default(''), notes: z.string().max(2000).default('') });
export const countrySchema = z.string().transform(value=>countryCode(value) ?? '').pipe(z.string().regex(/^[A-Z]{2}$/, '请选择有效国家或地区'));
const cityIdSchema = z.string().regex(/^\d{1,12}$/, '无效城市标识');
const timeZone = text.refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, '无效时区');
const clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'时间格式须为 HH:mm');
export const nodeSchema = entityBase.extend({ name: text, city: text, cityId: cityIdSchema.optional(), country: countrySchema, type: z.enum(['city', 'warehouse', 'airport', 'port', 'rail', 'border']), timeZone, airportId:text.optional() });
export const airportSchema=entityBase.extend({name:text,nameEn:text,iata:z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/,'IATA 代码须为三个英文字母'),country:countrySchema,city:text,cityId:cityIdSchema,timeZone,aliases:z.array(text).max(50).default([]),notes:z.string().max(2000).default('')});
export const flightSchema=entityBase.extend({
  laneId:text,flightNumber:z.string().trim().toUpperCase().transform(v=>v.replace(/\s/g,'')).pipe(z.string().min(1).max(30)),kind:z.enum(['weekly','date']),
  validFrom:date,validTo:date,operatingDate:date.optional(),weekdays:z.array(z.number().int().min(0).max(6)).max(7).default([]),timeZone,
  offBlockTime:clock,takeoffTime:clock.optional(),landingTime:clock.optional(),onBlockTime:clock,
  takeoffDayOffset:z.number().int().min(0).max(14).default(0),landingDayOffset:z.number().int().min(0).max(14).default(0),arrivalDayOffset:z.number().int().min(0).max(14).default(0),
  aircraft:z.string().max(100).default(''),registration:z.string().max(40).default(''),cutoffHours:amount.max(8760).nullable().default(null),
  status:z.enum(['planned','confirmed','cancelled','archived']).default('planned'),source:z.string().max(300).default(''),notes:z.string().max(2000).default(''),
}).superRefine((v,ctx)=>{
  const error=(message:string)=>ctx.addIssue({code:'custom',message});
  if(v.validTo<v.validFrom)error('时刻有效期结束不能早于开始');
  if(v.kind==='weekly'&&!v.weekdays.length)error('周期班期须选择星期');
  if(v.kind==='date'&&(!v.operatingDate||v.operatingDate<v.validFrom||v.operatingDate>v.validTo))error('指定执行日期须在有效期内');
  const minutes=(value:string,offset=0)=>Number(value.slice(0,2))*60+Number(value.slice(3))+offset*1440;
  const values=[minutes(v.offBlockTime),...(v.takeoffTime?[minutes(v.takeoffTime,v.takeoffDayOffset)]:[]),...(v.landingTime?[minutes(v.landingTime,v.landingDayOffset)]:[]),minutes(v.onBlockTime,v.arrivalDayOffset)];
  if(values.some((n,i)=>i>0&&n<values[i-1])||values.at(-1)===values[0])error('撤轮、起飞、落地、挡轮时间须按跨日偏移先后排列');
});
const scheduleSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: text.refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, '无效时区'),
  cutoffHours: amount.max(8760),
});
export const laneSchema = entityBase.extend({
  name: text, supplierId: text, from: text, to: text, mode: z.enum(modes),
  transitHours: positive.max(87600).optional(), handlingHours: amount.max(8760).default(0),
  fromAirportId:text.optional(),toAirportId:text.optional(),
  validFrom: date.default('0001-01-01'), validTo: date.default('9999-12-31'),validityUnknown:z.boolean().default(false), onDemand: z.boolean().default(false), schedule: scheduleSchema.optional(),
  capabilities: z.record(z.enum(cargoFlags), z.enum(['yes', 'no', 'unknown'])).default({ oversized: 'unknown', hazardous: 'unknown', batteryInstalled: 'unknown', batteryPacked: 'unknown', batteryOnly: 'unknown', liquid: 'unknown', temperature: 'unknown' }),
  maxLengthCm: positive.optional(), maxWidthCm: positive.optional(), maxHeightCm: positive.optional(), maxPieceKg: positive.optional(),
  maxShipmentKg: positive.optional(), maxShipmentCbm: positive.optional(),
  hazardousClasses: z.array(text).default([]), unNumbers: z.array(z.string().regex(/^UN\d{4}$/)).default([]),
  containerTypes: z.array(text).default([]),
  services: z.array(z.object({ name: text, status: z.enum(['included', 'excluded', 'unknown']) })).default([]),
  notes: z.string().max(2000).default(''),
}).refine(v => v.from !== v.to, '起止节点不能相同').refine(v => v.validTo >= v.validFrom, '有效期结束不能早于开始');
export const rateSchema = entityBase.extend({
  name: text, laneId: text, currency: z.string().regex(/^[A-Z]{3}$/), unit: z.enum(units), price: amount,
  minimum: amount.default(0), rounding: positive.default(1), volumetricDivisor: positive.default(6000),
  bands: z.array(z.object({ upTo: positive, price: amount })).default([]),
  surcharges: z.array(z.object({ name: text, kind: z.enum(['fixed', 'percent']), amount })).default([]),
  containerType: z.string().max(30).default(''), validFrom: date, validTo: date,
  notes: z.string().max(2000).default(''),
}).refine(v => v.validTo >= v.validFrom, '有效期结束不能早于开始');
export const fxSchema = entityBase.extend({ currency: z.string().regex(/^[A-Z]{3}$/), toCny: positive, validFrom: date, validTo: date }).refine(v => v.validTo >= v.validFrom, '有效期结束不能早于开始').refine(v => v.currency !== 'CNY' || v.toCny === 1, '人民币汇率必须为 1');
export const cargoSchema = z.object({
  name: text, pieces: z.number().int().positive().max(1000000), lengthCm: positive, widthCm: positive, heightCm: positive, weightKg: positive,
  stackable: z.boolean().default(false), upright: z.boolean().default(true), flags: z.array(z.enum(cargoFlags)).default([]),
  hazardousClass: z.string().max(30).default(''), unNumber: z.union([z.literal(''), z.string().regex(/^UN\d{4}$/)]).default(''),
  packaging: z.string().max(100).default(''),
});
export const requestSchema = z.object({
  originCountry: countrySchema, originCity: text, originCityId: cityIdSchema.optional(), destinationCountry: countrySchema, destinationCity: text, destinationCityId: cityIdSchema.optional(), readyAt: timestamp, deadline: timestamp.optional(),
  cargo: z.array(cargoSchema).min(1).max(100), vehicleCount: z.number().int().positive().max(10000).optional(),
  containerCount: z.number().int().positive().max(10000).optional(), containerType: z.string().max(30).default(''),
  notes: z.string().max(2000).default(''),
}).refine(v => !sameCity({country:v.originCountry,city:v.originCity,cityId:v.originCityId},{country:v.destinationCountry,city:v.destinationCity,cityId:v.destinationCityId}), '起运地与目的地不能是同一国家的同一城市').refine(v => !v.deadline || Date.parse(v.deadline) >= Date.parse(v.readyAt), '最晚送达不能早于可提货时间');
export const schemas = { suppliers: supplierSchema,airports:airportSchema, nodes: nodeSchema, lanes: laneSchema,flights:flightSchema, rates: rateSchema, fx: fxSchema };
export const kinds = ['suppliers','airports', 'nodes', 'lanes','flights', 'rates', 'fx'] as const;
export type Kind = typeof kinds[number];
export type Supplier = z.infer<typeof supplierSchema>;
export type TransportNode = z.infer<typeof nodeSchema>;
export type Airport=z.infer<typeof airportSchema>;
export type Flight=z.infer<typeof flightSchema>;
export const airportNode=(airport:Airport):TransportNode=>({id:airport.id,version:airport.version,name:`${airport.iata} · ${airport.name}`,country:airport.country,city:airport.city,cityId:airport.cityId,type:'airport',timeZone:airport.timeZone,airportId:airport.id});
export type Lane = z.infer<typeof laneSchema>;
export type Rate = z.infer<typeof rateSchema>;
export type Fx = z.infer<typeof fxSchema>;
export type Demand = z.infer<typeof requestSchema>;
export type Catalog = { suppliers: Supplier[];airports:Airport[]; nodes: TransportNode[]; lanes: Lane[];flights:Flight[]; rates: Rate[]; fx: Fx[] };
export const emptyCatalog = (): Catalog => ({ suppliers: [],airports:[], nodes: [], lanes: [],flights:[], rates: [], fx: [] });
export type PriceBreakdown = { rateId: string; rateName: string; currency: string; quantity: number; unit: string; unitPrice: number; freight: number; surcharges: { name: string; amount: number }[]; total: number; cny?: number; exchangeRate?: number; fxId?: string };
export type Leg = { laneId: string;selectionId?:string;flight?:{rule:Flight;offBlockAt:string;takeoffAt?:string;landingAt?:string;onBlockAt:string};timingUnknown?:boolean; name: string; supplierName: string; from: TransportNode; to: TransportNode; mode: typeof modes[number]; departure: string; arrival: string; missing: boolean; warnings: string[]; price?: PriceBreakdown; services: Lane['services'] };
export type Candidate = { id: string; legs: Leg[]; warnings: string[]; complete: boolean;timingComplete?:boolean; priceComplete: boolean; knownCny: number; totalCny?: number; hours: number; arrival: string; lateHours: number; badges: string[] };
export type SolveResult = { candidates: Candidate[]; diagnostics: string[]; truncated: boolean; explored: number };
export type SavedPlan = { id: string; groupId: string; version: number; title: string; notes: string; createdAt: string; request: Demand; candidate: Candidate; catalog: Catalog };
