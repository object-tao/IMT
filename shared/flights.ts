import type { Flight,Lane,Leg,Candidate } from './model.js';
import { localToEpoch,zoneDate } from './time.js';

export function addDays(date:string,days:number){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export const selectionId=(leg:Pick<Leg,'laneId'|'selectionId'>)=>leg.selectionId ?? leg.laneId;
export const timingKnown=(candidate:Pick<Candidate,'timingComplete'|'legs'>)=>candidate.timingComplete??candidate.legs.every(l=>!l.missing&&!l.timingUnknown);
export const flightLabel=(flight:Flight)=>`${flight.flightNumber} · ${flight.kind==='date'?flight.operatingDate:'每周'+[...flight.weekdays].sort((a,b)=>(a||7)-(b||7)).map(d=>['日','一','二','三','四','五','六'][d]).join('/')} · ${flight.offBlockTime} → ${flight.onBlockTime}${flight.arrivalDayOffset?` (+${flight.arrivalDayOffset}天)`:''} · ${flight.timeZone}`;

export function nextFlight(rule:Flight,rules:Flight[],lane:Lane,earliest:number,departureTimeZone=rule.timeZone):NonNullable<Leg['flight']>|undefined{
  if(rule.status==='cancelled'||rule.status==='archived')return;
  const laneStart=lane.validFrom==='0001-01-01'?undefined:localToEpoch(lane.validFrom,'00:00',departureTimeZone);
  const first=[zoneDate(earliest+(rule.cutoffHours ?? 0)*3600000,rule.timeZone),rule.validFrom,...(laneStart===undefined?[]:[zoneDate(laneStart,rule.timeZone)])].sort().at(-1)!;
  const last=rule.validTo;
  const overrides=rules.filter(f=>f.kind==='date'&&f.status!=='archived'&&f.flightNumber.replace(/\s/g,'')===rule.flightNumber.replace(/\s/g,''));
  const dates=rule.kind==='date'?[rule.operatingDate!]:Array.from({length:Math.min(36600,overrides.length*7+15)},(_,n)=>addDays(first,n));
  for(const date of dates){
    if(date<first||date>last)continue;
    if(rule.kind==='weekly'&&(!rule.weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())||overrides.some(f=>f.operatingDate===date)))continue;
    const off=localToEpoch(date,rule.offBlockTime,rule.timeZone),on=localToEpoch(addDays(date,rule.arrivalDayOffset),rule.onBlockTime,rule.timeZone);
    const takeoff=rule.takeoffTime?localToEpoch(addDays(date,rule.takeoffDayOffset),rule.takeoffTime,rule.timeZone):undefined;
    const landing=rule.landingTime?localToEpoch(addDays(date,rule.landingDayOffset),rule.landingTime,rule.timeZone):undefined;
    if(off===undefined||on===undefined||on<=off||off-(rule.cutoffHours ?? 0)*3600000<earliest)continue;
    const departureDate=zoneDate(off,departureTimeZone);if(departureDate<lane.validFrom||departureDate>lane.validTo)continue;
    if((rule.takeoffTime&&takeoff===undefined)||(rule.landingTime&&landing===undefined))continue;
    const sequence=[off,...(takeoff===undefined?[]:[takeoff]),...(landing===undefined?[]:[landing]),on];
    if(sequence.some((v,i)=>i>0&&v<sequence[i-1]))continue;
    return {rule,offBlockAt:new Date(off).toISOString(),onBlockAt:new Date(on).toISOString(),...(takeoff===undefined?{}:{takeoffAt:new Date(takeoff).toISOString()}),...(landing===undefined?{}:{landingAt:new Date(landing).toISOString()})};
  }
}
