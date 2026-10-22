import { countryCode, normalizeCity, sameCity, type GeoCity } from './geography.js';
import { flagNames, type Catalog, type Demand, type Leg, type TransportNode } from './model.js';

// Resolved by the server from the city database, never trusted from a browser payload.
export type PlanningContext = { cities: GeoCity[] };
export const emptyPlanningContext = (): PlanningContext => ({ cities: [] });

const europeanRoadScope = new Set('AL AD AT BE BA BG HR CZ DK EE FI FR DE GR HU IT XK LV LI LT LU MC ME NL MK NO PL PT RO SM RS SK SI ES SE CH VA'.split(' '));
const cityKey = (node: TransportNode) => `${countryCode(node.country)}|${node.cityId ?? normalizeCity(node.city)}`;
const trunkModes = new Set(['air', 'rail', 'sea']);

function withinSuggestionScope(from: GeoCity, to: GeoCity): boolean {
  // These are conservative search regions, not a road-connectivity certificate.
  // Even within these bounds, islands, borders and cargo conditions require checking.
  if (from.country === 'CN' && to.country === 'CN') return true;
  const continentalUS = (city: GeoCity) => city.country === 'US' && city.latitude >= 24 && city.latitude <= 50 && city.longitude >= -125 && city.longitude <= -66;
  if (continentalUS(from) && continentalUS(to)) return true;
  const europe = (city: GeoCity) => europeanRoadScope.has(city.country) && city.latitude >= 35 && city.latitude <= 72 && city.longitude >= -11 && city.longitude <= 40;
  return europe(from) && europe(to);
}

export function destinationRoadConnection(catalog: Catalog, request: Demand, context: PlanningContext, ends: TransportNode[]) {
  const cities = new Map(context.cities.map(city => [city.id, city]));
  const endIds = new Set(ends.map(node => node.id));
  const nodes = new Map(catalog.nodes.map(node => [node.id, node]));
  const reverseRoads = new Map<string, Set<string>>();
  for (const lane of catalog.lanes) {
    if (lane.mode !== 'road' && lane.mode !== 'transfer') continue;
    const from = nodes.get(lane.from), to = nodes.get(lane.to);
    if (!from || !to) continue;
    const predecessors = reverseRoads.get(cityKey(to)) ?? new Set<string>();
    predecessors.add(cityKey(from));
    reverseRoads.set(cityKey(to), predecessors);
  }
  // A placeholder must not bypass known cargo restrictions, closed dates or an
  // invalid downstream road leg. Suppress it when any maintained city corridor exists.
  const maintainedCorridor = new Set(ends.map(cityKey));
  const queue = [...maintainedCorridor];
  for (let index = 0; index < queue.length; index++) {
    for (const predecessor of reverseRoads.get(queue[index]) ?? []) {
      if (!maintainedCorridor.has(predecessor)) { maintainedCorridor.add(predecessor); queue.push(predecessor); }
    }
  }
  return (from: TransportNode, to: TransportNode, previous: Leg | undefined): boolean => {
    if (!previous || previous.missing || !trunkModes.has(previous.mode) || previous.to.id !== from.id) return false;
    if (!endIds.has(to.id) || sameCity(from, to) || maintainedCorridor.has(cityKey(from))) return false;
    const origin = from.cityId ? cities.get(from.cityId) : undefined;
    const destination = to.cityId ? cities.get(to.cityId) : undefined;
    return !!origin && !!destination && origin.country === countryCode(from.country) && destination.country === countryCode(to.country)
      && sameCity(to, { country: request.destinationCountry, city: request.destinationCity, cityId: request.destinationCityId })
      && withinSuggestionScope(origin, destination);
  };
}

export function roadConnectionLeg(from: TransportNode, to: TransportNode, earliest: number, request: Demand): Leg {
  const flags = [...new Set(request.cargo.flatMap(item => item.flags))];
  return {
    laneId: `road-gap|${from.id}|${to.id}`, name: '公路转运建议', supplierName: '待匹配公路供应商',
    from, to, mode: 'road', departure: new Date(earliest).toISOString(), arrival: new Date(earliest).toISOString(), missing: true, timingUnknown: true,
    warnings: [
      `${from.city} → ${to.city}：建议补充公路转运供应商及线路，当前仅为待落实的方案框架`,
      '实际道路连通、是否涉及轮渡、承运范围、车辆装载条件及货物适运性待核实',
      '陆运距离、提货等待、运输时效及费用待确认，不能据此承诺交期或完整报价',
      '到站提货、清关／转关、放行及目的地派送安排待确认',
      ...flags.map(flag => `${flagNames[flag]}公路承运条件待确认`),
    ], services: [],
  };
}
