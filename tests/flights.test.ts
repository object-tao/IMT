import { describe,it,expect } from 'vitest';
import { airFixture } from './air-fixture.js';
import { flightSchema } from '../shared/model.js';
import { nextFlight,selectionId } from '../shared/flights.js';
import { solve,evaluatePath } from '../shared/engine.js';
import { validateCatalog } from '../server/store.js';
import { exportHtml } from '../server/export.js';

describe('独立飞行时刻与方案衔接',()=>{
  it('四项时间使用表内北京时间，目的机场夏令时变化不会改变飞行耗时',()=>{
    const {catalog:c,flight:f}=airFixture();
    const a=nextFlight(f,[f],c.lanes[0],Date.parse('2026-10-22T00:00:00Z'))!;
    const b=nextFlight(f,[f],c.lanes[0],Date.parse('2026-10-26T00:00:00Z'))!;
    expect(a.offBlockAt).toBe('2026-10-22T19:00:00.000Z');expect(a.takeoffAt).toBe('2026-10-22T19:20:00.000Z');expect(a.landingAt).toBe('2026-10-23T05:00:00.000Z');
    expect(Date.parse(a.onBlockAt)-Date.parse(a.offBlockAt)).toBe(10.25*3600000);expect(Date.parse(b.onBlockAt)-Date.parse(b.offBlockAt)).toBe(10.25*3600000);
  });
  it('指定日期优先，取消的指定日期使该日周期班次停飞；归档后恢复周期规则',()=>{
    const {catalog:c,flight:f}=airFixture(),ready=Date.parse('2026-10-25T00:00:00Z');
    const override=flightSchema.parse({...f,id:'override',kind:'date',operatingDate:'2026-10-26',offBlockTime:'04:00',takeoffTime:'04:20',status:'planned'});
    expect(nextFlight(f,[f,override],c.lanes[0],ready)?.offBlockAt).toBe('2026-10-27T19:00:00.000Z');
    expect(nextFlight(override,[f,override],c.lanes[0],ready)?.offBlockAt).toBe('2026-10-25T20:00:00.000Z');
    override.status='cancelled';expect(nextFlight(override,[f,override],c.lanes[0],ready)).toBeUndefined();expect(nextFlight(f,[f,override],c.lanes[0],ready)?.offBlockAt).toBe('2026-10-27T19:00:00.000Z');
    override.status='archived';expect(nextFlight(f,[f,override],c.lanes[0],ready)?.offBlockAt).toBe('2026-10-25T19:00:00.000Z');
  });
  it('跨日偏移和截货时间生效，过期、取消和不存在的班次不能选用',()=>{
    const {catalog:c,flight:f,request,path}=airFixture();
    const overnight=flightSchema.parse({...f,offBlockTime:'23:00',takeoffTime:'23:20',landingTime:'09:00',onBlockTime:'09:15',landingDayOffset:1,arrivalDayOffset:1});
    const a=nextFlight(overnight,[overnight],c.lanes[0],Date.parse('2026-10-22T00:00:00Z'))!;expect(a.onBlockAt).toBe('2026-10-24T01:15:00.000Z');
    expect(nextFlight(f,[f],c.lanes[0],Date.parse('2026-10-22T18:00:00Z'))?.offBlockAt).toBe('2026-10-25T19:00:00.000Z');
    expect(nextFlight({...f,status:'cancelled'},[f],c.lanes[0],Date.parse(request.readyAt))).toBeUndefined();
    c.flights=[{...f,validTo:'2026-10-21'}];expect(()=>evaluatePath(c,request,path)).toThrow('无可衔接');
    c.flights=[];expect(()=>evaluatePath(c,request,path)).toThrow('不存在');
    expect(flightSchema.safeParse({...f,onBlockTime:'02:00'}).success).toBe(false);
  });
  it('目的地为欧洲当地时间的春季不存在时刻不能被误用',()=>{
    const {catalog:c,flight:f}=airFixture();const rule=flightSchema.parse({...f,kind:'date',operatingDate:'2026-03-29',validFrom:'2026-03-29',validTo:'2026-03-29',timeZone:'Europe/Prague',offBlockTime:'02:30',takeoffTime:'03:30',landingTime:'10:00',onBlockTime:'10:15'});
    expect(nextFlight(rule,[rule],c.lanes[0],Date.parse('2026-03-28T00:00:00Z'))).toBeUndefined();
  });
  it('航线有效期按起飞机场当地日期校验，与表内日期跨日不冲突',()=>{
    const {catalog:c,flight:f}=airFixture();const lane={...c.lanes[0],validFrom:'2026-10-24',validTo:'2026-10-24'};
    const rule=flightSchema.parse({...f,kind:'date',validFrom:'2026-10-25',validTo:'2026-10-25',operatingDate:'2026-10-25',offBlockTime:'02:00',takeoffTime:'02:20'});
    expect(nextFlight(rule,[rule],lane,Date.parse('2026-10-23T00:00:00Z'),'Europe/Prague')?.offBlockAt).toBe('2026-10-24T18:00:00.000Z');
  });
  it('同一路径可保留不同班次；保存选择后不会换成最早班次',()=>{
    const {catalog:c,request,flight:f,path}=airFixture();const other={...f,id:'test-flight-b',flightNumber:'XX5678',offBlockTime:'05:00',takeoffTime:'05:20'};c.flights=[f,other];
    const candidates=solve(c,request).candidates.filter(c=>!c.legs.some(l=>l.missing));expect(candidates).toHaveLength(2);expect(new Set(candidates.map(c=>c.id)).size).toBe(2);
    const b=evaluatePath(c,request,[path[0],`flight|air-test-lane|${other.id}`,path[2]]);expect(b.legs[1].flight?.rule.id).toBe(other.id);expect(evaluatePath(c,request,b.legs.map(selectionId)).id).toBe(b.id);
  });
  it('没有时刻的航线仍展示待确认框架；未知前序段会使后续衔接待确认，导出隐藏承诺时间',()=>{
    const {catalog:c,request,flight:f,path}=airFixture();const p=evaluatePath(c,request,[path[0],'air-test-lane',path[2]]);
    expect(p.timingComplete).toBe(false);expect(p.complete).toBe(false);expect(p.lateHours).toBe(0);expect(p.legs[1].warnings.join()).toContain('未维护飞行时刻');expect(p.legs[2].timingUnknown).toBe(true);
    const html=exportHtml({id:'p',groupId:'g',version:1,title:'测试',notes:'',createdAt:request.readyAt,request,candidate:p,catalog:c},false);expect(html).toContain('送达时间待确认');expect(html).not.toContain('预计到达：');
    c.flights=[f];c.lanes=c.lanes.filter(l=>l.id!=='test-pickup');const candidate=solve(c,request).candidates[0];expect(candidate.legs[0].missing).toBe(true);expect(candidate.legs[1].timingUnknown).toBe(true);expect(candidate.timingComplete).toBe(false);
  });
  it('活动周期规则重叠和指定日期重复被拒绝，归档历史及不同航班可共存',()=>{
    const {catalog:c,flight:f}=airFixture();c.flights=[f,{...f,id:'duplicate'}];expect(()=>validateCatalog(c)).toThrow('重叠');
    c.flights[1].status='archived';expect(()=>validateCatalog(c)).not.toThrow();
    c.flights=[{...f,kind:'date',operatingDate:'2026-10-26'},{...f,id:'date-duplicate',kind:'date',operatingDate:'2026-10-26'}];expect(()=>validateCatalog(c)).toThrow('重复时刻');
    c.flights[1].flightNumber='XX9999';expect(()=>validateCatalog(c)).not.toThrow();
  });
});
