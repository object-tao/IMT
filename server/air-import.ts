import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readCsvRows } from '../shared/csv.js';
import { emptyCatalog,flightSchema,laneSchema,type Catalog,type Flight,type Airport } from '../shared/model.js';
import type { AirImportPreview } from '../shared/air-import.js';
import { AppError,validateCatalog } from './store.js';

const array=(v:any):any[]=>v===undefined?[]:Array.isArray(v)?v:[v];
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,processEntities:true,trimValues:false});
const column=(ref:string)=>ref.replace(/\d/g,'').split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
const rich=(v:any):string=>typeof v==='string'?v:typeof v?.['#text']==='string'?v['#text']:v?.t!==undefined?rich(v.t):array(v?.r).map((r:any)=>rich(r)).join('');
export async function workbookRows(buffer:Buffer):Promise<unknown[][]>{
  const zip=await JSZip.loadAsync(buffer);
  const xml=async(path:string)=>{
    const entry=zip.file(path);if(!entry)return undefined;
    const value=await new Promise<string>((resolve,reject)=>{
      const stream=entry.nodeStream(),chunks:Buffer[]=[];let bytes=0;
      stream.on('data',chunk=>{const data=Buffer.from(chunk);bytes+=data.length;if(bytes>12*1024*1024){stream.pause();(stream as unknown as {destroy:()=>void}).destroy();reject(new AppError(400,'工作表解压后过大，请拆分文件'));return;}chunks.push(data);});
      stream.on('error',reject);stream.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });
    if(/<!DOCTYPE|<!ENTITY/i.test(value))throw new AppError(400,'不支持含实体声明的工作表');return parser.parse(value);
  };
  const shared=await xml('xl/sharedStrings.xml'),strings=array(shared?.sst?.si).map(rich);
  const book=await xml('xl/workbook.xml'),relations=await xml('xl/_rels/workbook.xml.rels');
  if(['1','true'].includes(String(book?.workbook?.workbookPr?.['@_date1904'])))throw new AppError(400,'请将 1904 日期系统工作簿另存为标准日期系统或导出文本日期 CSV');
  const first=array(book?.workbook?.sheets?.sheet)[0];
  const relation=array(relations?.Relationships?.Relationship).find(r=>r['@_Id']===first?.['@_r:id']);
  const target=String(relation?.['@_Target'] ?? 'worksheets/sheet1.xml').replace(/^\//,'');
  if(target.includes('..'))throw new AppError(400,'工作表路径不正确');
  const sheet=await xml(target.startsWith('xl/')?target:`xl/${target}`);if(!sheet?.worksheet)throw new AppError(400,'未找到可读取的工作表');
  const rows:unknown[][]=[];
  for(const row of array(sheet.worksheet.sheetData?.row)){
    const n=Number(row['@_r'])-1;if(!Number.isInteger(n)||n<0||n>2001)throw new AppError(400,'最多支持 2000 行，请拆分文件');
    const cells:unknown[]=[];
    for(const cell of array(row.c)){
      const i=column(String(cell['@_r']));if(i<0||i>100)throw new AppError(400,'工作表列数过多');
      if(cell.f!==undefined)throw new AppError(400,'请将公式转换为值后导入');
      cells[i]=cell['@_t']==='s'?strings[Number(cell.v)]:cell['@_t']==='inlineStr'?rich(cell.is):cell['@_t']==='n'||(!cell['@_t']&&cell.v!==undefined)?Number(cell.v):cell.v ?? '';
    }
    rows[n]=cells;
  }
  for(const merge of array(sheet.worksheet.mergeCells?.mergeCell)){
    const [start,end]=String(merge['@_ref']).split(':');if(!end)continue;
    const r1=Number(start.match(/\d+/)?.[0])-1,r2=Number(end.match(/\d+/)?.[0])-1,c1=column(start),c2=column(end);
    if(r1<0||r2>2001||c1<0||c2>100)throw new AppError(400,'合并单元格范围过大');
    for(let r=r1;r<=r2;r++){rows[r]??=[];for(let c=c1;c<=c2;c++)rows[r][c]=rows[r1]?.[c1] ?? '';}
  }
  return Array.from({length:rows.length},(_,i)=>rows[i] ?? []);
}

export const airImportSchema=z.object({supplierId:z.string().min(1),year:z.number().int().min(2000).max(2100),month:z.number().int().min(1).max(12),timeZone:z.string().default('Asia/Shanghai'),source:z.string().min(1).max(300),rows:z.array(z.array(z.union([z.string(),z.number(),z.null()]))).max(2001).optional(),file:z.object({name:z.string().max(300),base64:z.string().max(7*1024*1024)}).optional()});
const clean=(value:unknown)=>String(value ?? '').trim().replace(/\s/g,'');
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const clock=(value:unknown)=>{
  if(typeof value==='number'&&value>=0&&value<1){const m=Math.round(value*1440);return `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
  const s=String(value ?? '').trim();if(!s)return undefined;const match=s.match(/^(\d{1,2})[:：](\d{2})(?::\d{2})?$/);if(!match)throw new Error(`时间“${s}”无法识别`);return `${match[1].padStart(2,'0')}:${match[2]}`;
};
function period(value:unknown,year:number,month:number):{from:string;to:string;date?:string}{
  const date=(m:number,d:number)=>{const s=`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(!z.iso.date().safeParse(s).success)throw new Error('执行日期无效');return s;};
  if(typeof value==='number'&&value>1000){const s=new Date(Math.round((value-25569)*86400000)).toISOString().slice(0,10);if(!s.startsWith(String(year)))throw new Error('Excel 执行日期年份与所选年份不同');return {from:s,to:s,date:s};}
  const s=clean(value).replace(/[—–至~～]/g,'-');
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){if(!s.startsWith(String(year)))throw new Error('执行日期年份与所选年份不同');return {from:s,to:s,date:s};}
  const range=s.match(/^(?:(\d{1,2})月)?(\d{1,2})日?-(?:(\d{1,2})月)?(\d{1,2})日?$/);
  if(range)return {from:date(Number(range[1]??month),Number(range[2])),to:date(Number(range[3]??range[1]??month),Number(range[4]))};
  const one=s.match(/^(?:(\d{1,2})[月/])?(\d{1,2})日?$/);if(one){const d=date(Number(one[1]??month),Number(one[2]));return {from:d,to:d,date:d};}
  throw new Error('执行日期需填写日期区间或指定日期，不能留空');
}
const operational=(f:Flight)=>JSON.stringify([f.offBlockTime,f.takeoffTime,f.landingTime,f.onBlockTime,f.takeoffDayOffset,f.landingDayOffset,f.arrivalDayOffset,f.timeZone,f.aircraft,f.registration]);
export async function previewAirImport(input:unknown,current:Catalog):Promise<AirImportPreview>{
  const body=airImportSchema.parse(input);if(!current.suppliers.some(s=>s.id===body.supplierId))throw new AppError(400,'请选择已存在的供应商');
  try{new Intl.DateTimeFormat('en',{timeZone:body.timeZone});}catch{throw new AppError(400,'时刻表时区无效');}
  let rows:unknown[][]=body.rows ?? [];
  if(body.file){const data=Buffer.from(body.file.base64,'base64');if(data.length>5*1024*1024)throw new AppError(400,'文件不能超过 5 MB');rows=body.file.name.toLowerCase().endsWith('.xlsx')?await workbookRows(data):body.file.name.toLowerCase().endsWith('.csv')?readCsvRows(data.toString('utf8')):(()=>{throw new AppError(400,'支持 XLSX 或 CSV 文件；截图请先核对整理为表格');})();}
  const headerIndex=rows.findIndex(row=>row.some(v=>clean(v)==='航班号'||clean(v)==='flightNumber'));if(headerIndex<0)throw new AppError(400,'未找到航班号表头，请使用航线时刻模板');
  const header=rows[headerIndex].map(clean),find=(...names:string[])=>header.findIndex(h=>names.includes(h));
  const stationIndices=header.map((h,i)=>h==='航站'?i:-1).filter(i=>i>=0);
  const indexes={from:find('起飞机场','起运机场','fromAirport'),to:find('目的机场','到达机场','toAirport'),number:find('航班号','flightNumber'),off:find('撤轮时间','撤轮挡时间','offBlockTime'),takeoff:find('起飞时间','takeoffTime'),landing:find('落地时间','landingTime'),on:find('挡轮时间','上轮挡时间','onBlockTime'),week:find('班期','weekdays'),period:find('执行日期','执行范围','operatingPeriod'),aircraft:find('执飞机型','机型','aircraft'),registration:find('机号','registration'),takeoffDay:find('起飞跨日','takeoffDayOffset'),landingDay:find('落地跨日','landingDayOffset'),arrivalDay:find('到达跨日','arrivalDayOffset')};
  if(indexes.from<0)indexes.from=stationIndices[0]??-1;if(indexes.to<0)indexes.to=stationIndices[1]??-1;
  if(['from','to','number','off','on','period'].some(key=>indexes[key as keyof typeof indexes]<0))throw new AppError(400,'缺少起止机场、航班号、撤轮、挡轮或执行日期表头');
  const incoming=emptyCatalog(),preview:AirImportPreview={catalog:incoming,rows:[],errors:[],newLanes:0,newFlights:0,existing:0,source:body.source};
  const airport=(value:unknown):Airport=>{const query=clean(value).toLocaleLowerCase();const matches=current.airports.filter(a=>[a.iata,a.name,a.nameEn,...a.aliases].some(v=>clean(v).toLocaleLowerCase()===query));if(matches.length!==1)throw new Error(`机场“${String(value??'')}”${matches.length?'匹配不唯一':'尚未维护'}，请先维护机场资料或使用三字代码`);return matches[0];};
  for(let n=headerIndex+1;n<rows.length;n++){
    const row=rows[n];if(!row.some(v=>clean(v)))continue;
    const get=(key:keyof typeof indexes)=>row[indexes[key]];
    const item:AirImportPreview['rows'][number]={row:n+1,route:'',flight:'',period:'',times:'',details:'',action:'new',errors:[]};
    try{
      const from=airport(get('from')),to=airport(get('to'));if(from.id===to.id)throw new Error('起止机场不能相同');
      item.route=`${from.iata} → ${to.iata}`;const number=clean(get('number')).toUpperCase();item.flight=number;
      const p=period(get('period'),body.year,body.month);item.period=p.date ?? `${p.from}—${p.to}`;
      const related=[...current.lanes,...incoming.lanes].filter(l=>l.supplierId===body.supplierId&&l.mode==='air'&&l.fromAirportId===from.id&&l.toAirportId===to.id);if(related.length>1)throw new Error('存在多条相同起止机场的供应商航线，请先合并或明确航线');
      const lane=related[0] ?? laneSchema.parse({id:`air-${hash([body.supplierId,from.id,to.id])}`,name:`${from.iata}—${to.iata} 航线`,supplierId:body.supplierId,from:from.id,to:to.id,fromAirportId:from.id,toAirportId:to.id,mode:'air',validityUnknown:true,onDemand:false,notes:'航线经营有效期、承运条件、截货及运价待供应商确认'});
      const weekday=clean(get('week')).split(/[,，/、]/).filter(Boolean).map(v=>{const d=Number(v);return d===7?0:d;});
      const model=String(get('aircraft')??'').trim(),reg=String(get('registration')??'').trim()||model.match(/[（(]([^）)]+)[）)]/)?.[1]||'';
      const identity=[lane.id,number,p.date?'date':'weekly',p.from,p.to,[...new Set(weekday)].sort()];
      const f=flightSchema.parse({id:`flt-${hash(identity)}`,laneId:lane.id,flightNumber:number,kind:p.date?'date':'weekly',validFrom:p.from,validTo:p.to,operatingDate:p.date,weekdays:p.date?[]:weekday,timeZone:body.timeZone,offBlockTime:clock(get('off')),takeoffTime:clock(get('takeoff')),landingTime:clock(get('landing')),onBlockTime:clock(get('on')),takeoffDayOffset:Number(get('takeoffDay')||0),landingDayOffset:Number(get('landingDay')||0),arrivalDayOffset:Number(get('arrivalDay')||0),aircraft:model.replace(/[（(].*$/,'').trim(),registration:reg,source:body.source});
      if(p.date&&weekday.length&&!weekday.includes(new Date(p.date+'T00:00:00Z').getUTCDay()))throw new Error('指定执行日期与班期星期不一致');
      item.times=`${f.offBlockTime} / ${f.takeoffTime??'—'} (+${f.takeoffDayOffset}) / ${f.landingTime??'—'} (+${f.landingDayOffset}) / ${f.onBlockTime} (+${f.arrivalDayOffset})`;
      item.details=`${f.kind==='date'?'指定日期':'周'+f.weekdays.map(d=>['日','一','二','三','四','五','六'][d]).join('/')} · ${f.aircraft||'机型待确认'} ${f.registration}`;
      const existing=[...current.flights,...incoming.flights].find(v=>v.laneId===f.laneId&&v.flightNumber.replace(/\s/g,'')===number&&v.kind===f.kind&&v.validFrom===f.validFrom&&v.validTo===f.validTo&&(f.kind==='date'?v.operatingDate===f.operatingDate:JSON.stringify([...v.weekdays].sort())===JSON.stringify([...f.weekdays].sort())));
      if(existing){if(operational(existing)!==operational(f))throw new Error('已有同班期时刻的时间或机型不同，请编辑原记录以保留历史');item.action='existing';preview.existing++;}
      else{if(!related.length)incoming.lanes.push(lane);incoming.flights.push(f);}
    }catch(e){item.action='error';item.errors=[e instanceof z.ZodError?e.issues.map(v=>v.message).join('；'):(e as Error).message];}
    preview.rows.push(item);
  }
  preview.newLanes=incoming.lanes.length;preview.newFlights=incoming.flights.length;
  if(!preview.rows.length)preview.errors.push('没有可导入的时刻行');
  try{validateCatalog({...current,lanes:[...current.lanes,...incoming.lanes],flights:[...current.flights,...incoming.flights]});}catch(e){preview.errors.push((e as Error).message);}
  return preview;
}
