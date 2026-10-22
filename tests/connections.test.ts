import { describe, it, expect } from 'vitest';
import { solve, evaluatePath } from '../shared/engine.js';
import { selectionId } from '../shared/flights.js';
import { laneSchema, type Catalog, type TransportNode } from '../shared/model.js';
import type { PlanningContext } from '../shared/connections.js';
import type { GeoCity } from '../shared/geography.js';
import { Geography } from '../server/geography.js';
import { airFixture } from './air-fixture.js';

// Public geography only; every supplier, lane and flight comes from fictional fixtures.
const cityIds = {
  chengdu: '1815286', prague: '3067696', paris: '2988507', london: '2643743',
  shanghai: '1796236', beijing: '1816670', losAngeles: '5368361', newYork: '5128581',
  honolulu: '5856195', strasbourg: '2973783',
} as const;

function geographyContext(): PlanningContext {
  const geography = new Geography();
  try {
    return { cities: Object.values(cityIds).map(id => {
      const city = geography.get(id);
      if (!city) throw new Error(`Missing public test city ${id}`);
      return city;
    }) };
  } finally { geography.close(); }
}

function city(context: PlanningContext, name: keyof typeof cityIds): GeoCity {
  return context.cities.find(c => c.id === cityIds[name])!;
}

function cityNode(id: string, value: GeoCity, type: TransportNode['type'] = 'city'): TransportNode {
  return { id, version: 1, name: `${value.name}测试覆盖点`, country: value.country,
    city: value.name, cityId: value.id, type, timeZone: value.timeZone };
}

function fixture(destination: keyof typeof cityIds = 'paris') {
  const { catalog, request: original, flight } = airFixture();
  catalog.nodes = catalog.nodes.filter(n => n.type === 'airport');
  catalog.lanes = catalog.lanes.filter(l => l.mode === 'air');
  catalog.flights = [flight];
  const context = geographyContext(), to = city(context, destination);
  const request = { ...original, destinationCountry: to.country, destinationCity: to.name, destinationCityId: to.id };
  return { catalog, request, context };
}

function relocateArrival(catalog: Catalog, value: GeoCity) {
  const arrival = catalog.nodes.find(n => n.id === 'test-prg')!;
  Object.assign(arrival, { country: value.country, city: value.name, cityId: value.id, timeZone: value.timeZone });
}

function road(catalog: Catalog, id: string, from: string, to: string, extra: object = {}) {
  catalog.lanes.push(laneSchema.parse({ id, name: id, supplierId: catalog.suppliers[0].id,
    from, to, mode: 'road', transitHours: 10, onDemand: true,
    validFrom: '2026-01-01', validTo: '2026-12-31', ...extra }));
}

const inferred = (id: string) => id.startsWith('road-gap|');

describe('干线到达后的待补全公路转运', () => {
  it('目的城市未维护节点时仍展示成都经布拉格到巴黎，并保持推导与重新校验一致', () => {
    const { catalog, request, context } = fixture();
    const original = structuredClone(catalog);
    const result = solve(catalog, request, context);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      const terminal = candidate.legs.at(-1)!;
      expect(terminal.from.cityId).toBe(cityIds.prague);
      expect(terminal.to.cityId).toBe(cityIds.paris);
      expect(terminal.to.type).toBe('city');
      expect(inferred(terminal.laneId)).toBe(true);
      expect(terminal.mode).toBe('road');
      expect(terminal.missing).toBe(true);
      expect(terminal.timingUnknown).toBe(true);
      expect(terminal.price).toBeUndefined();
      expect(candidate.complete).toBe(false);
      expect(candidate.timingComplete).toBe(false);
      expect(candidate.priceComplete).toBe(false);
      expect(candidate.totalCny).toBeUndefined();
      expect(candidate.badges).toEqual([]);
      expect(candidate.legs.filter(l => l.laneId.startsWith('gap|')).length).toBeLessThanOrEqual(2);
      expect(evaluatePath(catalog, request, candidate.legs.map(selectionId), context)).toEqual(candidate);
    }
    expect(catalog).toEqual(original);
  });

  it('未维护飞行时刻时仍保留路线框架，不能输出完整时效或价格', () => {
    const { catalog, request, context } = fixture();
    catalog.flights = [];
    const candidates = solve(catalog, request, context).candidates;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c => !c.complete && !c.timingComplete && !c.priceComplete)).toBe(true);
    expect(candidates[0].legs.find(l => l.mode === 'air')!.warnings.join()).toContain('未维护飞行时刻');
    expect(candidates.every(c => inferred(c.legs.at(-1)!.laneId))).toBe(true);
  });

  it.each(['rail', 'sea'] as const)('已维护的 %s 干线也能接待补全公路段', mode => {
    const { catalog, request, context } = fixture();
    catalog.airports = [];
    catalog.flights = [];
    for (const node of catalog.nodes) { node.type = mode === 'rail' ? 'rail' : 'port'; delete node.airportId; }
    const trunk = catalog.lanes[0];
    trunk.mode = mode; trunk.onDemand = true; trunk.transitHours = 48;
    delete trunk.fromAirportId; delete trunk.toAirportId;
    const candidates = solve(catalog, request, context).candidates;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c => inferred(c.legs.at(-1)!.laneId) && c.legs.at(-2)!.mode === mode)).toBe(true);
  });

  it.each([
    ['shanghai', 'beijing'], ['losAngeles', 'newYork'],
  ] as const)('支持已维护干线到 %s 后向 %s 的国内公路转运建议', (arrival, destination) => {
    const { catalog, request, context } = fixture(destination);
    relocateArrival(catalog, city(context, arrival));
    expect(solve(catalog, request, context).candidates.some(c => inferred(c.legs.at(-1)!.laneId))).toBe(true);
  });

  it.each(['newYork', 'london', 'honolulu'] as const)('不会推测跨洋或范围外的布拉格到 %s 公路段', destination => {
    const { catalog, request, context } = fixture(destination);
    expect(solve(catalog, request, context).candidates).toHaveLength(0);
    expect(() => evaluatePath(catalog, request,
      ['gap|__origin__|test-ctu', 'flight|air-test-lane|test-flight-a', 'road-gap|test-prg|__destination__'], context)).toThrow();
  });

  it('美国同国跨海目的地不因国家相同就被当作大陆公路可达', () => {
    const { catalog, request, context } = fixture('honolulu');
    relocateArrival(catalog, city(context, 'losAngeles'));
    expect(solve(catalog, request, context).candidates).toHaveLength(0);
  });

  it('没有干线资源时不会凭空拼出公路全程', () => {
    const { catalog, request, context } = fixture();
    catalog.lanes = []; catalog.flights = [];
    expect(solve(catalog, request, context).candidates).toHaveLength(0);
    expect(() => evaluatePath(catalog, request, ['road-gap|__origin__|__destination__'], context)).toThrow();
  });

  it.each(['oversized', 'hazardous'] as const)('干线明确拒收 %s 时不能通过缺失段绕开限制', flag => {
    const { catalog, request, context } = fixture();
    request.cargo[0].flags = [flag];
    catalog.lanes[0].capabilities[flag] = 'no';
    expect(solve(catalog, request, context).candidates).toHaveLength(0);
  });

  it.each(['expired', 'cancelled'] as const)('过期或取消的航班（%s）不能用于推荐后续转运', status => {
    const { catalog, request, context } = fixture();
    if (status === 'expired') catalog.flights[0].validTo = '2026-10-21';
    else catalog.flights[0].status = 'cancelled';
    expect(solve(catalog, request, context).candidates).toHaveLength(0);
  });

  it.each(['denied', 'expired'] as const)('已有其他同城节点的公路资源即使 %s 也不能被推测段绕开', status => {
    const { catalog, request, context } = fixture();
    catalog.nodes.push(cityNode('test-prague-warehouse', city(context, 'prague'), 'warehouse'), cityNode('test-paris', city(context, 'paris')));
    road(catalog, 'test-existing-road', 'test-prague-warehouse', 'test-paris', status === 'expired' ? { validTo: '2026-10-21' } : { maxPieceKg: 1 });
    expect(solve(catalog, request, context).candidates).toHaveLength(0);
    expect(() => evaluatePath(catalog, request,
      ['gap|__origin__|test-ctu', 'flight|air-test-lane|test-flight-a', 'road-gap|test-prg|test-paris'], context)).toThrow();
  });

  it('已有多段公路通道受限制时，不能自动直连目的地跳过该通道限制', () => {
    const { catalog, request, context } = fixture();
    catalog.nodes.push(cityNode('test-prague-warehouse', city(context, 'prague'), 'warehouse'),
      cityNode('test-strasbourg', city(context, 'strasbourg')), cityNode('test-paris', city(context, 'paris')));
    road(catalog, 'test-road-first', 'test-prague-warehouse', 'test-strasbourg');
    road(catalog, 'test-road-second', 'test-strasbourg', 'test-paris', { maxPieceKg: 1 });
    expect(solve(catalog, request, context).candidates).toHaveLength(0);
  });

  it('反方向公路资源不阻止正向待补全转运建议', () => {
    const { catalog, request, context } = fixture();
    catalog.nodes.push(cityNode('test-paris', city(context, 'paris')));
    road(catalog, 'test-road-reverse', 'test-paris', 'test-prg');
    expect(solve(catalog, request, context).candidates.some(c => inferred(c.legs.at(-1)!.laneId))).toBe(true);
  });

  it('目的城市有多个覆盖点时，公路推测段仍必须是路径最后一段', () => {
    const { catalog, request, context } = fixture();
    catalog.nodes.push(cityNode('test-paris-a', city(context, 'paris')), cityNode('test-paris-b', city(context, 'paris')));
    road(catalog, 'test-paris-local', 'test-paris-a', 'test-paris-b');
    const candidate = solve(catalog, request, context).candidates.find(c => c.legs.at(-1)!.to.id === 'test-paris-a')!;
    expect(candidate).toBeDefined();
    expect(() => evaluatePath(catalog, request, [...candidate.legs.map(selectionId), 'test-paris-local'], context)).toThrow();
  });

  it('重新校验拒绝伪造、非末段或起终点不符合规则的自动公路段', () => {
    const { catalog, request, context } = fixture();
    const candidate = solve(catalog, request, context).candidates[0];
    expect(candidate).toBeDefined();
    const ids = candidate.legs.map(selectionId), terminal = candidate.legs.at(-1)!;
    expect(() => evaluatePath(catalog, request, [...ids.slice(0, -1), `${terminal.laneId}|extra`], context)).toThrow();
    expect(() => evaluatePath(catalog, request, [...ids.slice(0, -1), 'road-gap|test-prg|test-ctu'], context)).toThrow();
    expect(() => evaluatePath(catalog, request, [terminal.laneId, ...ids.slice(0, -1)], context)).toThrow();
    expect(() => evaluatePath(catalog, request, [...ids, 'air-test-lane'], context)).toThrow();
    expect(() => evaluatePath(catalog, request, [`road-gap|${candidate.legs[0].from.id}|${terminal.to.id}`], context)).toThrow();
  });
});
