import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { countryCode, normalizeCity, type GeoCity, type GeoMetadata } from '../shared/geography.js';
import type { Catalog, Demand, TransportNode, SavedPlan } from '../shared/model.js';
import type { PlanningContext } from '../shared/connections.js';
import { AppError } from './store.js';

export class Geography {
  private db?: DatabaseSync;
  constructor(file=process.env.GEO_DATABASE_FILE ?? resolve('assets/geography/world.sqlite')) {
    if(existsSync(file))this.db=new DatabaseSync(file,{readOnly:true});
  }
  get available(){return !!this.db;}
  metadata(): GeoMetadata | null { const row=this.db?.prepare('SELECT value FROM metadata WHERE key=?').get('dataset');return row ? JSON.parse(String(row.value)) : null; }
  private city(row: Record<string,any>): GeoCity { return {id:String(row.id),country:row.country,name:row.name,nameEn:row.ascii_name,admin1:row.admin1,timeZone:row.timezone,latitude:row.latitude,longitude:row.longitude,population:row.population}; }
  private requireDb(){if(!this.db)throw new AppError(503,'全球城市库尚未安装，请运行 npm run geo:sync 后重启服务');return this.db;}
  get(id:string): GeoCity | undefined {const row=this.requireDb().prepare('SELECT * FROM cities WHERE id=?').get(id);return row ? this.city(row) : undefined;}
  search(country:string,q='',offset=0,limit=40): {items:GeoCity[];hasMore:boolean;nextOffset:number|null} {
    const db=this.requireDb(),code=countryCode(country);if(!code)throw new AppError(400,'无效国家');
    const tokens=(q.match(/[\p{L}\p{N}]+/gu) ?? []).map(t=>`"${t}"*`);
    const rows=tokens.length ? db.prepare('SELECT c.* FROM city_search JOIN cities c ON c.rowid=city_search.rowid WHERE city_search MATCH ? ORDER BY c.population DESC,c.id LIMIT ? OFFSET ?').all(`country:"${code}" AND aliases:(${tokens.join(' AND ')})`,limit+1,offset) : db.prepare('SELECT * FROM cities WHERE country=? ORDER BY population DESC,id LIMIT ? OFFSET ?').all(code,limit+1,offset);
    return {items:rows.slice(0,limit).map(row=>this.city(row)),hasMore:rows.length>limit,nextOffset:rows.length>limit ? offset+limit : null};
  }
  resolve(country:string,name:string): GeoCity | undefined {
    const code=countryCode(country);if(!code || !name.trim() || !this.available)return undefined;
    const candidates=this.search(code,name,0,80).items.filter(city=>{
      const row=this.db!.prepare('SELECT aliases FROM cities WHERE id=?').get(city.id)!;
      return String(row.aliases).split('\n').some(alias=>normalizeCity(alias)===normalizeCity(name));
    });
    // An old name without a place ID must not arbitrarily select one of several same-name cities.
    return candidates.length===1 ? candidates[0] : undefined;
  }
  bindNode(node: TransportNode,strict=false): TransportNode {
    const code=countryCode(node.country);if(!code)throw new AppError(400,'运输节点国家无效');
    const city=node.cityId ? this.get(node.cityId) : this.resolve(code,node.city);
    if(node.cityId && (!city || city.country!==code))throw new AppError(400,'城市与所选国家不匹配');
    if(strict && !city)throw new AppError(400,'请选择城市库中的明确城市；同名城市需按行政区区分');
    return {...node,country:code,...(city ? {city:city.name,cityId:city.id} : {})};
  }
  bindDemand(request: Demand): Demand {
    const origin=request.originCityId ? this.get(request.originCityId) : this.resolve(request.originCountry,request.originCity);
    const destination=request.destinationCityId ? this.get(request.destinationCityId) : this.resolve(request.destinationCountry,request.destinationCity);
    if(!origin || origin.country!==request.originCountry)throw new AppError(400,'起运城市与国家不匹配，或城市名称不明确，请从候选城市中选择');
    if(!destination || destination.country!==request.destinationCountry)throw new AppError(400,'目的城市与国家不匹配，或城市名称不明确，请从候选城市中选择');
    if(origin.id===destination.id)throw new AppError(400,'起运地与目的地不能是同一城市');
    return {...request,originCity:origin.name,originCityId:origin.id,destinationCity:destination.name,destinationCityId:destination.id};
  }
  planningContext(request: Demand, catalog: Catalog): PlanningContext {
    const ids = new Set([request.originCityId, request.destinationCityId, ...catalog.nodes.map(node => node.cityId)]);
    return { cities: [...ids].filter((id): id is string => !!id).map(id => this.get(id)).filter((city): city is GeoCity => !!city) };
  }
  close(){this.db?.close();}
}
// Legacy plan snapshots remain immutable; missing country fields are projected from saved legs.
export function upgradePlanLocation(plan: SavedPlan): SavedPlan {
  const first=plan.candidate.legs[0]?.from,last=plan.candidate.legs.at(-1)?.to;
  return {...plan,request:{...plan.request,originCountry:plan.request.originCountry ?? countryCode(first?.country ?? '') ?? '',destinationCountry:plan.request.destinationCountry ?? countryCode(last?.country ?? '') ?? '',originCityId:plan.request.originCityId ?? first?.cityId,destinationCityId:plan.request.destinationCityId ?? last?.cityId}};
}
