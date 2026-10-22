import { cargoFlags, laneSchema, rateSchema, type Catalog, type Demand } from './model.js';
export function demoCatalog(): Catalog {
  const suppliers = [
    { id: 's-road', name: '示例 · 国内陆运资源', contact: '', notes: '演示数据，不代表真实承运能力或报价', version: 1 },
    { id: 's-air-a', name: '示例 · 欧洲空运 A', contact: '', notes: '演示数据', version: 1 },
    { id: 's-air-b', name: '示例 · 欧洲空运 B', contact: '', notes: '演示数据', version: 1 },
    { id: 's-sea', name: '示例 · 海运资源', contact: '', notes: '演示数据', version: 1 },
    { id: 's-uk', name: '示例 · 英国派送资源', contact: '', notes: '演示数据', version: 1 },
    { id: 's-rail', name: '示例 · 中欧铁路', contact: '', notes: '演示数据', version: 1 },
  ];
  const nodes: Catalog['nodes'] = [
    { id: 'sh', cityId: '1796236', name: '上海城市覆盖点', city: '上海', country: '中国', type: 'city', timeZone: 'Asia/Shanghai', version: 1 },
    { id: 'cdw', cityId: '1815286', name: '成都集货仓', city: '成都', country: '中国', type: 'warehouse', timeZone: 'Asia/Shanghai', version: 1 },
    { id: 'ctu', cityId: '1815286', name: '成都机场货站', city: '成都', country: '中国', type: 'airport', timeZone: 'Asia/Shanghai', version: 1 },
    { id: 'lhr', cityId: '2643743', name: '伦敦机场货站', city: '伦敦', country: '英国', type: 'airport', timeZone: 'Europe/London', version: 1 },
    { id: 'lon', cityId: '2643743', name: '伦敦城市覆盖点', city: '伦敦', country: '英国', type: 'city', timeZone: 'Europe/London', version: 1 },
    { id: 'sha-port', cityId: '1796236', name: '上海港', city: '上海', country: '中国', type: 'port', timeZone: 'Asia/Shanghai', version: 1 },
    { id: 'fel', cityId: '2649579', name: '费利克斯托港', city: '费利克斯托', country: '英国', type: 'port', timeZone: 'Europe/London', version: 1 },
    { id: 'dui', cityId: '2934691', name: '杜伊斯堡铁路站', city: '杜伊斯堡', country: '德国', type: 'rail', timeZone: 'Europe/Berlin', version: 1 },
  ];
  const base = { validFrom: '2020-01-01', validTo: '2099-12-31', capabilities: Object.fromEntries(cargoFlags.map(f => [f, f === 'batteryInstalled' ? 'yes' : f === 'hazardous' || f === 'batteryOnly' ? 'no' : 'yes'])), maxLengthCm: 1200, maxWidthCm: 350, maxHeightCm: 350, maxPieceKg: 30000, services: [{ name: '装卸', status: 'included' }], notes: '仅用于演示；全部费用和承运参数均为虚构' };
  const lane = (id: string, name: string, from: string, to: string, mode: string, supplierId: string, transitHours: number, scheduled = false) => laneSchema.parse({ ...base, id, name, from, to, mode, supplierId, transitHours, handlingHours: scheduled ? 12 : 2, onDemand: !scheduled, ...(scheduled ? { schedule: { weekdays: mode === 'sea' ? [3, 6] : [1, 3, 5, 0], departureTime: '18:00', timeZone: 'Asia/Shanghai', cutoffHours: 8 } } : {}) });
  const lanes = [
    lane('l-dom', '上海—成都集货', 'sh', 'cdw', 'road', 's-road', 32),
    lane('l-transfer', '成都仓库—机场接驳', 'cdw', 'ctu', 'transfer', 's-road', 3),
    lane('l-air-a', '成都—伦敦空运 A', 'ctu', 'lhr', 'air', 's-air-a', 14, true),
    lane('l-air-b', '成都—伦敦空运 B', 'ctu', 'lhr', 'air', 's-air-b', 20, true),
    lane('l-uk-a', '伦敦机场—城市派送', 'lhr', 'lon', 'road', 's-uk', 12),
    lane('l-uk-b', '伦敦机场—加急派送', 'lhr', 'lon', 'road', 's-uk', 4),
    lane('l-port', '上海市内—港区', 'sh', 'sha-port', 'road', 's-road', 6),
    lane('l-sea', '上海港—英国海运', 'sha-port', 'fel', 'sea', 's-sea', 720, true),
    lane('l-fel', '英国港口—伦敦派送', 'fel', 'lon', 'road', 's-uk', 16),
    lane('l-rail', '上海—杜伊斯堡铁路', 'sh', 'dui', 'rail', 's-rail', 360, true),
    lane('l-eu', '德国—英国跨境派送', 'dui', 'lon', 'road', 's-uk', 36),
  ];
  const rate = (id: string, laneId: string, price: number, currency = 'CNY', unit = 'shipment') => rateSchema.parse({ id, laneId, name: '示例参考运价', price, currency, unit, validFrom: base.validFrom, validTo: base.validTo, minimum: 0, surcharges: [] });
  const rates = [rate('r-dom', 'l-dom', 3, 'CNY', 'kg'), rate('r-transfer', 'l-transfer', 500), rate('r-air-a', 'l-air-a', 25, 'CNY', 'chargeableKg'), rate('r-air-b', 'l-air-b', 21, 'CNY', 'chargeableKg'), rate('r-uk-a', 'l-uk-a', 160, 'GBP'), rate('r-uk-b', 'l-uk-b', 260, 'GBP'), rate('r-port', 'l-port', 800), rate('r-sea', 'l-sea', 65, 'USD', 'cbm'), rate('r-fel', 'l-fel', 500, 'GBP'), rate('r-rail', 'l-rail', 1000, 'CNY', 'cbm'), rate('r-eu', 'l-eu', 550, 'EUR')];
  return { suppliers, airports:[], flights:[], nodes, lanes, rates, fx: [{ id: 'fx-gbp', version: 1, currency: 'GBP', toCny: 9.3, validFrom: base.validFrom, validTo: base.validTo }, { id: 'fx-usd', version: 1, currency: 'USD', toCny: 7.1, validFrom: base.validFrom, validTo: base.validTo }, { id: 'fx-eur', version: 1, currency: 'EUR', toCny: 8, validFrom: base.validFrom, validTo: base.validTo }] };
}
export function demoDemand(): Demand {
  const ready = new Date(); ready.setUTCDate(ready.getUTCDate() + 1); ready.setUTCHours(0, 0, 0, 0);
  return { originCountry: 'CN', originCityId: '1796236', originCity: '上海', destinationCountry: 'GB', destinationCityId: '2643743', destinationCity: '伦敦', readyAt: ready.toISOString(), deadline: new Date(ready.getTime() + 12 * 86400000).toISOString(), cargo: [{ name: '示例机械设备', pieces: 2, lengthCm: 120, widthCm: 100, heightCm: 100, weightKg: 300, stackable: false, upright: true, flags: [], hazardousClass: '', unNumber: '', packaging: '木箱' }], containerType: '', notes: '' };
}
