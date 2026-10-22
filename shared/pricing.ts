import { Decimal } from 'decimal.js';
import type { Demand, Catalog, PriceBreakdown, Rate } from './model.js';
export function totals(request: Demand) {
  return request.cargo.reduce((sum, item) => ({
    kg: sum.kg.plus(new Decimal(item.weightKg).times(item.pieces)),
    cbm: sum.cbm.plus(new Decimal(item.lengthCm).times(item.widthCm).times(item.heightCm).times(item.pieces).div(1e6)),
    pieces: sum.pieces + item.pieces,
  }), { kg: new Decimal(0), cbm: new Decimal(0), pieces: 0 });
}
const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
export function priceRate(rate: Rate, request: Demand, catalog: Catalog, date: string): PriceBreakdown | undefined {
  const total = totals(request);
  let quantity: Decimal;
  switch (rate.unit) {
    case 'kg': quantity = total.kg; break;
    case 'cbm': quantity = total.cbm; break;
    case 'chargeableKg': quantity = Decimal.max(total.kg, total.cbm.times(1e6).div(rate.volumetricDivisor)); break;
    case 'shipment': quantity = new Decimal(1); break;
    case 'vehicle': if (!request.vehicleCount) return; quantity = new Decimal(request.vehicleCount); break;
    case 'container': if (!request.containerCount || !request.containerType || (rate.containerType && request.containerType !== rate.containerType)) return; quantity = new Decimal(request.containerCount); break;
  }
  quantity = quantity.div(rate.rounding).ceil().times(rate.rounding);
  const band = [...rate.bands].sort((a,b) => a.upTo - b.upTo).find(b => quantity.lte(b.upTo));
  const unitPrice = band?.price ?? rate.price;
  const freight = Decimal.max(quantity.times(unitPrice), rate.minimum).toDecimalPlaces(2);
  const surcharges = rate.surcharges.map(s => ({ name: s.name, amount: money(s.kind === 'fixed' ? new Decimal(s.amount) : freight.times(s.amount).div(100)) }));
  const amount = surcharges.reduce((v,s) => v.plus(s.amount), freight);
  const fx = catalog.fx.filter(f => f.currency === rate.currency && f.validFrom <= date && f.validTo >= date).sort((a,b) => b.validFrom.localeCompare(a.validFrom))[0];
  const exchangeRate = rate.currency === 'CNY' ? 1 : fx?.toCny;
  return { rateId: rate.id, rateName: rate.name, currency: rate.currency, quantity: quantity.toNumber(), unit: rate.unit, unitPrice, freight: money(freight), surcharges, total: money(amount), ...(exchangeRate !== undefined ? { cny: money(amount.times(exchangeRate)), exchangeRate, fxId: fx?.id } : {}) };
}
