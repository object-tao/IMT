import { describe, it, expect } from 'vitest';
import { demoCatalog, demoDemand } from '../shared/demo.js';
import { solve, evaluatePath } from '../shared/engine.js';
import { rateSchema, requestSchema } from '../shared/model.js';
import { priceRate, totals } from '../shared/pricing.js';
import { nextDeparture, localToEpoch } from '../shared/time.js';
const demand = () => ({ ...demoDemand(), readyAt: '2026-10-22T00:00:00Z', deadline: '2026-11-03T00:00:00Z' });
const airPath = ['l-dom','l-transfer','l-air-a','l-uk-a'];
describe('多式联运方案', () => {
  it('拼接不同供应商并保留同一路径的多个供应商方案', () => {
    const result = solve(demoCatalog(),demand());
    expect(result.candidates.length).toBeGreaterThan(4);
    expect(result.candidates.some(c => c.legs.some(l => l.laneId === 'l-air-a'))).toBe(true);
    expect(result.candidates.some(c => c.legs.some(l => l.laneId === 'l-air-b'))).toBe(true);
    expect(result.candidates.some(c => c.badges.includes('参考费用最低'))).toBe(true);
    expect(result.candidates.every(c => c.legs.every((l,i) => !i || c.legs[i-1].to.id === l.from.id))).toBe(true);
  });
  it('缺价方案不参加完整费用排名', () => {
    const catalog = demoCatalog(); catalog.rates = catalog.rates.filter(r => r.laneId !== 'l-air-a');
    const candidates = solve(catalog,demand()).candidates.filter(c => c.legs.some(l => l.laneId === 'l-air-a'));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c => !c.priceComplete && c.totalCny === undefined && !c.badges.length)).toBe(true);
  });
  it('识别同城仓库与机场之间的缺失接驳', () => {
    const catalog = demoCatalog(); catalog.lanes = catalog.lanes.filter(l => l.id !== 'l-transfer');
    const c = solve(catalog,demand()).candidates.find(c => c.legs.some(l => l.laneId === 'l-air-a'))!;
    expect(c.legs.some(l => l.missing)).toBe(true); expect(c.complete).toBe(false); expect(c.badges).toEqual([]);
  });
  it('不能从起运城市机场直接出发而绕过城市提货', () => {
    const request = { ...demand(), originCity:'成都' };
    const result = solve(demoCatalog(),request);
    expect(result.candidates.every(c => c.legs[0].from.type === 'city' && c.legs[0].missing)).toBe(true);
  });
  it('明确不承运的货物被排除', () => {
    const request = demand(); request.cargo[0].flags = ['batteryOnly'];
    expect(solve(demoCatalog(),request).candidates).toHaveLength(0);
  });
  it('未知承运属性可展示但不能当作已校验通过', () => {
    const catalog = demoCatalog(); catalog.lanes.find(l => l.id === 'l-air-a')!.capabilities.liquid = 'unknown';
    const request = demand(); request.cargo[0].flags = ['liquid'];
    const c = evaluatePath(catalog,request,airPath);
    expect(c.complete).toBe(false); expect(c.warnings.join()).toContain('液体承运条件待确认');
  });
  it('大件逐件校验尺寸和重量', () => {
    const request = demand(); request.cargo[0].heightCm = 400;
    expect(solve(demoCatalog(),request).candidates).toHaveLength(0);
  });
  it('整票载荷限制按多组货物合计', () => {
    const catalog = demoCatalog(); catalog.lanes.find(l => l.id === 'l-dom')!.maxShipmentKg = 500;
    expect(() => evaluatePath(catalog,demand(),airPath)).toThrow('整票重量超限');
  });
  it('危险品类别和 UN 限制参与筛选', () => {
    const catalog = demoCatalog(); const lane = catalog.lanes.find(l => l.id === 'l-air-a')!;
    lane.capabilities.hazardous = 'yes'; lane.hazardousClasses = ['9']; lane.unNumbers = ['UN3481'];
    for (const id of ['l-dom','l-transfer','l-uk-a']) catalog.lanes.find(l => l.id === id)!.capabilities.hazardous = 'yes';
    const request = demand(); request.cargo[0].flags = ['hazardous']; request.cargo[0].hazardousClass = '9'; request.cargo[0].unNumber = 'UN3480';
    expect(() => evaluatePath(catalog,request,airPath)).toThrow('不承运 UN3480');
  });
  it('过期运价不用于报价，过期线路被排除', () => {
    const catalog = demoCatalog(); catalog.rates.find(r => r.laneId === 'l-dom')!.validTo = '2025-01-01';
    expect(evaluatePath(catalog,demand(),airPath).priceComplete).toBe(false);
    catalog.lanes.find(l => l.id === 'l-dom')!.validTo = '2025-01-01';
    expect(() => evaluatePath(catalog,demand(),airPath)).toThrow('有效期');
  });
  it('缺少有效外汇汇率时不输出完整人民币总价', () => {
    const catalog = demoCatalog(); catalog.fx = [];
    const c = evaluatePath(catalog,demand(),airPath); expect(c.totalCny).toBeUndefined(); expect(c.warnings.join()).toContain('汇率');
  });
  it('无法按时送达时仍展示方案及预计晚到时间', () => {
    const request = { ...demand(), deadline:'2026-10-22T01:00:00Z' };
    const result = solve(demoCatalog(),request); expect(result.candidates.length).toBeGreaterThan(0); expect(result.candidates.every(c => c.lateHours > 0)).toBe(true);
    expect(result.candidates.some(c => c.badges.includes('预计时效最快'))).toBe(true);
  });
  it('手工修改后校验节点连续性、循环及目的地', () => {
    expect(() => evaluatePath(demoCatalog(),demand(),['l-dom','l-air-a','l-uk-a'])).toThrow('不连续');
    expect(() => evaluatePath(demoCatalog(),demand(),['l-dom'])).toThrow('未到达');
  });
  it('没有起运资源时解释原因', () => { expect(solve(demoCatalog(),{...demand(),originCity:'未知城市'}).diagnostics.join()).toContain('起运城市'); });
  it('输入格式拒绝负数、空货物和倒置时间', () => {
    expect(requestSchema.safeParse({...demand(),cargo:[]}).success).toBe(false);
    expect(requestSchema.safeParse({...demand(),deadline:'2020-01-01T00:00:00Z'}).success).toBe(false);
  });
});
describe('运价与精度', () => {
  const rate = (changes: object = {}) => rateSchema.parse({ id:'test',name:'测试运价',laneId:'l-dom',unit:'kg',currency:'CNY',price:0.1,validFrom:'2020-01-01',validTo:'2099-12-31',...changes });
  it('多组件数参与重量体积合计', () => { const total = totals(demand()); expect(total.kg.toNumber()).toBe(600); expect(total.cbm.toNumber()).toBe(2.4); });
  it('体积重、进位、阶梯、最低收费和附加费可以组合', () => {
    const r = rate({unit:'chargeableKg',price:3,minimum:2500,rounding:100,bands:[{upTo:1000,price:2}],surcharges:[{name:'燃油',kind:'percent',amount:10},{name:'文件',kind:'fixed',amount:50}]});
    const p = priceRate(r,demand(),demoCatalog(),'2026-10-22')!;
    expect(p.quantity).toBe(600); expect(p.unitPrice).toBe(2); expect(p.freight).toBe(2500); expect(p.total).toBe(2800);
  });
  it('高体积低重量使用体积重', () => { const request = demand(); request.cargo[0].weightKg = 1; expect(priceRate(rate({unit:'chargeableKg'}),request,demoCatalog(),'2026-10-22')!.quantity).toBe(400); });
  it('按车按柜不擅自推算装载数量', () => {
    expect(priceRate(rate({unit:'vehicle'}),demand(),demoCatalog(),'2026-10-22')).toBeUndefined();
    expect(priceRate(rate({unit:'container',containerType:'40HC'}),{...demand(),containerCount:1,containerType:'20GP'},demoCatalog(),'2026-10-22')).toBeUndefined();
  });
  it('十进制费用避免浮点误差并按分取整', () => { const request = demand(); request.cargo[0].pieces=3; request.cargo[0].weightKg=1; expect(priceRate(rate(),request,demoCatalog(),'2026-10-22')!.total).toBe(0.3); });
});
describe('时区与班期', () => {
  it('北京时间转换正确', () => { expect(localToEpoch('2026-10-22','18:00','Asia/Shanghai')).toBe(Date.parse('2026-10-22T10:00:00Z')); });
  it('英国夏令时正确换算，跳过不存在的当地时间', () => { expect(localToEpoch('2026-07-01','12:00','Europe/London')).toBe(Date.parse('2026-07-01T11:00:00Z')); expect(localToEpoch('2026-03-29','01:30','Europe/London')).toBeUndefined(); });
  it('过截货时间后等待下个班次', () => {
    const schedule = {weekdays:[1,2,3,4,5,6,0],departureTime:'18:00',timeZone:'Asia/Shanghai',cutoffHours:8};
    const ready = Date.parse('2026-10-22T04:00:00Z'); // 12:00 local, cutoff 10:00
    expect(nextDeparture(ready,schedule,'2020-01-01','2099-12-31')).toBe(Date.parse('2026-10-23T10:00:00Z'));
  });
});
