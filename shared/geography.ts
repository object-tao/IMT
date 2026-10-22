import countryData from './countries.json' with { type: 'json' };
export const countries = countryData;
const normalize = (v: string) => v.trim().normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const lookup = new Map<string,string>();
for(const c of countries) for(const name of [c.code,c.iso3,c.name,c.nameEn,...c.aliases]) lookup.set(normalize(name),c.code);
for(const [alias,code] of Object.entries({UK:'GB','英国':'GB','美国':'US','中国':'CN','韩国':'KR','俄罗斯':'RU','台湾':'TW','香港':'HK','澳门':'MO','阿联酋':'AE','United States of America':'US','Great Britain':'GB'})) lookup.set(normalize(alias),code);
export function countryCode(value: string) { return lookup.get(normalize(value)); }
export function countryName(value?: string) { return value ? countries.find(c=>c.code===(countryCode(value) ?? value))?.name ?? value : ''; }
export function normalizeCity(value: string) { return normalize(value).replace(/([\p{Script=Han}])市$/u,'$1'); }
export function sameCountry(a: string,b: string) { const x=countryCode(a),y=countryCode(b); return !!x && x===y; }
export function sameCity(a: {country:string;city:string;cityId?:string},b: {country:string;city:string;cityId?:string}) {
  if(!sameCountry(a.country,b.country))return false;
  if(a.cityId || b.cityId)return !!a.cityId && !!b.cityId && a.cityId===b.cityId;
  return normalizeCity(a.city)===normalizeCity(b.city);
}
export type GeoCity = { id:string;country:string;name:string;nameEn:string;admin1:string;timeZone:string;latitude:number;longitude:number;population:number };
export type GeoMetadata = { source:string;sourceUrl:string;license:string;licenseUrl:string;builtAt:string;countries:number;cities:number;countriesWithCities:number;scope:string };
