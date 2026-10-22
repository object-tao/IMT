import { Decimal } from 'decimal.js';
import { flagNames, type Catalog, type Demand, type Lane, type Leg, type Candidate, type SolveResult, type TransportNode } from './model.js';
import { nextDeparture, zoneDate, localToEpoch } from './time.js';
import { priceRate, totals } from './pricing.js';

function compatibility(lane: Lane, request: Demand): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [], errors: string[] = [];
  const checks = [['lengthCm', 'maxLengthCm', '长度'], ['widthCm', 'maxWidthCm', '宽度'], ['heightCm', 'maxHeightCm', '高度'], ['weightKg', 'maxPieceKg', '单件重量']] as const;
  for (const item of request.cargo) {
    for (const [field, limit, label] of checks) {
      if (lane[limit] === undefined) warnings.push(`${label}限制待确认`);
      else if (item[field] > lane[limit]!) errors.push(`${item.name}${label}超限`);
    }
    for (const flag of item.flags) {
      if (lane.capabilities[flag] === 'no') errors.push(`不承运${flagNames[flag]}`);
      else if (lane.capabilities[flag] !== 'yes') warnings.push(`${flagNames[flag]}承运条件待确认`);
    }
    if (item.flags.includes('hazardous')) {
      if (!item.hazardousClass || !item.unNumber) warnings.push('危险品类别或 UN 编号待补充');
      if (lane.hazardousClasses.length && item.hazardousClass && !lane.hazardousClasses.includes(item.hazardousClass)) errors.push(`不承运危险品 ${item.hazardousClass} 类`);
      if (lane.unNumbers.length && item.unNumber && !lane.unNumbers.includes(item.unNumber)) errors.push(`不承运 ${item.unNumber}`);
    }
  }
  const total = totals(request);
  if (lane.maxShipmentKg !== undefined && total.kg.gt(lane.maxShipmentKg)) errors.push('整票重量超限');
  if (lane.maxShipmentCbm !== undefined && total.cbm.gt(lane.maxShipmentCbm)) errors.push('整票体积超限');
  if (request.containerType && lane.containerTypes.length && !lane.containerTypes.includes(request.containerType)) errors.push('箱型不适用');
  return { warnings: [...new Set(warnings)], errors: [...new Set(errors)] };
}

function makeLeg(lane: Lane, request: Demand, catalog: Catalog, earliest: number): { leg?: Leg; reason?: string } {
  const from = catalog.nodes.find(n => n.id === lane.from), to = catalog.nodes.find(n => n.id === lane.to);
  if (!from || !to) return { reason: '节点不存在' };
  const fit = compatibility(lane, request);
  if (fit.errors.length) return { reason: fit.errors.join('、') };
  let ready = earliest + lane.handlingHours * 3600000;
  if (zoneDate(ready, from.timeZone) < lane.validFrom) ready = localToEpoch(lane.validFrom, '00:00', from.timeZone) ?? ready;
  let departure = ready;
  if (!lane.onDemand && lane.schedule) {
    const value = nextDeparture(ready, lane.schedule, lane.validFrom, lane.validTo);
    if (value === undefined) return { reason: '有效期内无可衔接班期' };
    departure = value;
  } else if (!lane.onDemand) fit.warnings.push('班期未维护，出发时间仅作估算');
  const date = zoneDate(departure, from.timeZone);
  if (date < lane.validFrom || date > lane.validTo) return { reason: '线路不在有效期内' };
  const prices = catalog.rates.filter(r => r.laneId === lane.id && r.validFrom <= date && r.validTo >= date).map(r => priceRate(r, request, catalog, date)).filter(p => p !== undefined);
  prices.sort((a,b) => (a.cny ?? Infinity) - (b.cny ?? Infinity));
  const price = prices[0];
  if (!price) fit.warnings.push('缺少适用运价（请检查有效期、箱型及车／柜数量）');
  else if (price.cny === undefined) fit.warnings.push(`缺少 ${price.currency} 有效汇率`);
  for (const service of lane.services) {
    if (service.status === 'unknown') fit.warnings.push(`${service.name}包含情况待确认`);
    if (service.status === 'excluded') fit.warnings.push(`${service.name}未包含，相关费用待另行确认`);
  }
  if (lane.mode === 'road' && (from.type === 'city' || to.type === 'city')) fit.warnings.push('CITY_PRICE:城市覆盖范围计价，具体地址确认后可能调整');
  return { leg: { laneId: lane.id, name: lane.name, supplierName: catalog.suppliers.find(s => s.id === lane.supplierId)?.name ?? '供应商待确认', from, to, mode: lane.mode, departure: new Date(departure).toISOString(), arrival: new Date(departure + lane.transitHours * 3600000).toISOString(), missing: false, warnings: fit.warnings, price, services: lane.services } };
}
function gapLeg(from: TransportNode, to: TransportNode, earliest: number): Leg {
  return { laneId: `gap|${from.id}|${to.id}`, name: '缺失接驳段', supplierName: '待补充', from, to, mode: 'transfer', departure: new Date(earliest).toISOString(), arrival: new Date(earliest).toISOString(), missing: true, warnings: ['缺失运输段：费用与接驳时间均待确认'], services: [] };
}
function summarize(legs: Leg[], request: Demand): Candidate {
  const warnings = [...new Set(legs.flatMap(l => l.warnings.map(w => `${l.name}：${w.replace('CITY_PRICE:', '')}`)))];
  const priceComplete = legs.every(l => !l.missing && l.price?.cny !== undefined);
  const complete = priceComplete && legs.every(l => l.warnings.every(w => w.startsWith('CITY_PRICE:')));
  const knownCny = legs.reduce((sum,l) => sum.plus(l.price?.cny ?? 0), new Decimal(0)).toDecimalPlaces(2).toNumber();
  const arrival = legs.at(-1)!.arrival;
  const hours = (Date.parse(arrival) - Date.parse(request.readyAt)) / 3600000;
  const lateHours = request.deadline ? Math.max(0, (Date.parse(arrival) - Date.parse(request.deadline)) / 3600000) : 0;
  return { id: legs.map(l => l.laneId).join('>'), legs, warnings, complete, priceComplete, knownCny, ...(priceComplete ? { totalCny: knownCny } : {}), arrival, hours, lateHours, badges: [] };
}
function network(catalog: Catalog, request: Demand) {
  const origin = catalog.nodes.filter(n => n.city === request.originCity), destination = catalog.nodes.filter(n => n.city === request.destinationCity);
  const cityNode = (id: string, city: string, representative: TransportNode): TransportNode => ({ id, version: 1, name: `${city}城市覆盖点`, city, country: representative.country, type: 'city', timeZone: representative.timeZone });
  const originCityNodes = origin.filter(n => n.type === 'city'), destinationCityNodes = destination.filter(n => n.type === 'city');
  const starts = originCityNodes.length ? originCityNodes : origin.length ? [cityNode('__origin__', request.originCity, origin[0])] : [];
  const ends = destinationCityNodes.length ? destinationCityNodes : destination.length ? [cityNode('__destination__', request.destinationCity, destination[0])] : [];
  const nodes = [...catalog.nodes, ...starts.filter(n => n.id === '__origin__'), ...ends.filter(n => n.id === '__destination__')];
  return { starts, ends, nodes };
}
export function evaluatePath(catalog: Catalog, request: Demand, laneIds: string[]): Candidate {
  if (!laneIds.length || laneIds.length > 8) throw new Error('方案运输段数量必须为 1–8 段');
  const { starts, ends, nodes } = network(catalog, request);
  const legs: Leg[] = [];
  const visited = new Set<string>();
  for (const id of laneIds) {
    let leg: Leg | undefined;
    const earliest = legs.length ? Date.parse(legs.at(-1)!.arrival) : Date.parse(request.readyAt);
    if (id.startsWith('gap|')) {
      const [, a, b] = id.split('|');
      const from = nodes.find(n => n.id === a), to = nodes.find(n => n.id === b);
      if (!from || !to || from.city !== to.city || from.id === to.id) throw new Error('无效的待补全接驳段');
      leg = gapLeg(from, to, earliest);
    } else {
      const lane = catalog.lanes.find(l => l.id === id);
      if (!lane) throw new Error('运输资源不存在');
      const evaluated = makeLeg(lane, request, catalog, earliest);
      if (!evaluated.leg) throw new Error(`${lane.name}：${evaluated.reason}`);
      leg = evaluated.leg;
    }
    if ((!legs.length && !starts.some(n => n.id === leg.from.id)) || (legs.length && legs.at(-1)!.to.id !== leg.from.id)) throw new Error('运输段不连续');
    if (!visited.size) visited.add(leg.from.id);
    if (visited.has(leg.to.id)) throw new Error('运输方案包含循环');
    visited.add(leg.to.id);
    legs.push(leg);
  }
  if (!ends.some(n => n.id === legs.at(-1)!.to.id)) throw new Error('方案未到达目的城市覆盖点');
  return summarize(legs, request);
}
export function solve(catalog: Catalog, request: Demand): SolveResult {
  const { starts, ends, nodes } = network(catalog, request);
  const endIds = new Set(ends.map(n => n.id));
  const candidates: Candidate[] = [], rejected = new Set<string>();
  let explored = 0, truncated = false;
  const MAX_SEARCH = 20000, MAX_RESULTS = 300, MAX_LEGS = 8;
  const adjacent = new Map<string, Lane[]>();
  for (const lane of catalog.lanes) adjacent.set(lane.from, [...(adjacent.get(lane.from) ?? []), lane]);
  function walk(current: TransportNode, legs: Leg[], visited: Set<string>, gaps: number) {
    if (++explored > MAX_SEARCH || candidates.length >= MAX_RESULTS) { truncated = true; return; }
    if (endIds.has(current.id)) { if (legs.length) candidates.push(summarize(legs, request)); return; }
    if (legs.length >= MAX_LEGS) return;
    const earliest = legs.length ? Date.parse(legs.at(-1)!.arrival) : Date.parse(request.readyAt);
    for (const lane of adjacent.get(current.id) ?? []) {
      if (visited.has(lane.to)) continue;
      const evaluated = makeLeg(lane, request, catalog, earliest);
      if (!evaluated.leg) { rejected.add(`${lane.name}：${evaluated.reason}`); continue; }
      walk(evaluated.leg.to, [...legs, evaluated.leg], new Set([...visited, lane.to]), gaps);
      if (truncated) return;
    }
    if (gaps < 2 && !legs.at(-1)?.missing) {
      for (const next of nodes.filter(n => n.city === current.city && !visited.has(n.id))) {
        if ((adjacent.get(current.id) ?? []).some(l => l.to === next.id)) continue;
        const leg = gapLeg(current, next, earliest);
        walk(next, [...legs, leg], new Set([...visited, next.id]), gaps + 1);
        if (truncated) return;
      }
    }
  }
  for (const start of starts) { walk(start, [], new Set([start.id]), 0); if (truncated) break; }
  const qualified = candidates.filter(c => c.complete);
  const ontime = qualified.filter(c => !c.lateHours);
  const ranked = ontime.length ? ontime : qualified;
  if (ranked.length) {
    const cheapest = [...ranked].sort((a,b) => a.totalCny! - b.totalCny!)[0]; cheapest.badges.push('参考费用最低');
    const fastest = [...ranked].sort((a,b) => a.hours - b.hours)[0]; fastest.badges.push('预计时效最快');
    const minCost = Math.min(...ranked.map(c => c.totalCny!)), maxCost = Math.max(...ranked.map(c => c.totalCny!));
    const minTime = Math.min(...ranked.map(c => c.hours)), maxTime = Math.max(...ranked.map(c => c.hours));
    const score = (c: Candidate) => (c.totalCny! - minCost) / (maxCost - minCost || 1) + (c.hours - minTime) / (maxTime - minTime || 1);
    [...ranked].sort((a,b) => score(a) - score(b))[0].badges.push('费用时效折中');
  }
  candidates.sort((a,b) => Number(b.complete) - Number(a.complete) || Number(a.lateHours > 0) - Number(b.lateHours > 0) || (a.totalCny ?? Infinity) - (b.totalCny ?? Infinity) || a.hours - b.hours);
  const diagnostics = [...(!starts.length ? ['起运城市没有运输节点，请先维护资源'] : []), ...(!ends.length ? ['目的城市没有运输节点，请先维护资源'] : [])];
  if (!candidates.length) diagnostics.push('未找到可衔接的方案，请检查方向、节点、承运限制、班期和有效期', ...[...rejected].slice(0, 20));
  if (truncated) diagnostics.push('已达到搜索上限，结果为候选子集；推荐仅在本次已找到的方案中比较');
  if (candidates.some(c => c.legs.some(l => l.missing))) diagnostics.push('含缺失接驳段的方案，其到达时间不包含未知接驳耗时，不能据此承诺交期');
  return { candidates, diagnostics, truncated, explored };
}
