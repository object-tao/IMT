import { randomUUID } from 'node:crypto';
import { Database, type Sql } from './database.js';
import { schemas, kinds, emptyCatalog,airportNode, type Kind, type Catalog, type SavedPlan, type Demand,type Airport } from '../shared/model.js';
import { evaluatePath } from '../shared/engine.js';
import type { PlanningContext } from '../shared/connections.js';
import { upgradePlanLocation, type Geography } from './geography.js';

export class AppError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
export function validateCatalog(catalog: Catalog) {
  for (const kind of kinds) {
    const ids = new Set<string>();
    for (const item of catalog[kind]) { if (ids.has(item.id)) throw new AppError(400, `${kind} 存在重复 ID：${item.id}`); ids.add(item.id); }
  }
  for (const lane of catalog.lanes) {
    if (!catalog.suppliers.some(s => s.id === lane.supplierId)) throw new AppError(400, `${lane.name} 的供应商不存在`);
    if (![lane.from, lane.to].every(id => catalog.nodes.some(n => n.id === id))) throw new AppError(400, `${lane.name} 的起止节点不存在`);
    if(lane.mode!=='air'&&lane.transitHours===undefined)throw new AppError(400,'非航空线路须填写参考运输耗时');
    if(lane.fromAirportId||lane.toAirportId){
      if(lane.mode!=='air'||!lane.fromAirportId||!lane.toAirportId)throw new AppError(400,'航空航线须同时选择起止机场');
      if(lane.from!==lane.fromAirportId||lane.to!==lane.toAirportId||![lane.from,lane.to].every(id=>catalog.airports.some(a=>a.id===id)))throw new AppError(400,'航线起止机场与节点不匹配');
      if(lane.onDemand||lane.schedule)throw new AppError(400,'机场航线的时刻请在飞行时刻中维护，不能设为随到随发或内嵌班期');
    }
  }
  const codes=new Set<string>();
  for(const airport of catalog.airports){
    if(codes.has(airport.iata))throw new AppError(409,`机场三字代码 ${airport.iata} 已存在`);codes.add(airport.iata);
    const node=catalog.nodes.find(n=>n.id===airport.id),expected=airportNode(airport);
    if(!node||['name','country','city','cityId','type','timeZone','airportId'].some(key=>(node as any)[key] !== (expected as any)[key]))throw new AppError(400,'机场对应节点资料不一致，请在机场资料中修改');
  }
  for(const node of catalog.nodes)if(node.airportId&&!catalog.airports.some(a=>a.id===node.airportId&&a.id===node.id))throw new AppError(400,'机场节点缺少对应机场资料');
  for(const flight of catalog.flights){
    const lane=catalog.lanes.find(l=>l.id===flight.laneId);
    if(!lane||lane.mode!=='air')throw new AppError(400,'飞行时刻必须关联航空航线');
    if(!lane.fromAirportId||!lane.toAirportId)throw new AppError(400,'请先为航线关联机场资料，再维护独立飞行时刻');
  }
  const flightGroups=new Map<string,Catalog['flights']>();
  for(const flight of catalog.flights){if(flight.status==='archived')continue;const key=JSON.stringify([flight.laneId,flight.flightNumber.replace(/\s/g,''),flight.kind]);const group=flightGroups.get(key)??[];group.push(flight);flightGroups.set(key,group);}
  for(const group of flightGroups.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
    const a=group[i],b=group[j];
    if(a.kind==='date'&&a.operatingDate===b.operatingDate)throw new AppError(409,'同一航线、航班号和执行日期存在重复时刻，请编辑原记录');
    if(a.kind==='weekly'){
      const first=a.validFrom>b.validFrom?a.validFrom:b.validFrom,last=a.validTo<b.validTo?a.validTo:b.validTo;
      for(let n=0;n<7&&first<=last;n++){const date=new Date(Date.parse(first+'T00:00:00Z')+n*86400000);if(date.toISOString().slice(0,10)>last)break;if(a.weekdays.includes(date.getUTCDay())&&b.weekdays.includes(date.getUTCDay()))throw new AppError(409,'同一航线和航班的周期班期发生重叠，请调整有效期或编辑原记录');}
    }
  }
  for (const rate of catalog.rates) if (!catalog.lanes.some(l => l.id === rate.laneId)) throw new AppError(400, `${rate.name} 的线路不存在`);
}
export class Store {
  constructor(public db: Database) {}
  async migrateGeography(geo: Geography) {
    if(!geo.available)return;
    await this.db.transaction(async tx=>{
      if((await tx.query('SELECT version FROM migrations WHERE version=2')).length)return;
      const catalog=await this.catalog(tx);
      for(const node of catalog.nodes){
        const updated=geo.bindNode(node);
        if(JSON.stringify(updated)!==JSON.stringify(node)){
          updated.version=node.version+1;
          await tx.query('UPDATE resources SET version=?,payload=?,updated_at=? WHERE kind=? AND id=?',[updated.version,JSON.stringify(updated),new Date().toISOString(),'nodes',node.id]);
        }
      }
      await tx.query('INSERT INTO migrations(version,applied_at) VALUES(2,?)',[new Date().toISOString()]);
      await this.audit(tx,'geography.migrate','nodes');
    });
  }
  async catalog(tx: Sql = this.db): Promise<Catalog> {
    const rows = await tx.query('SELECT kind,payload FROM resources ORDER BY kind,id');
    const result = emptyCatalog();
    for (const row of rows) if(result[row.kind as Kind])result[row.kind as Kind].push(JSON.parse(row.payload));
    return result;
  }
  async audit(tx: Sql, action: string, subject: string) { await tx.query('INSERT INTO audit_events(id,action,subject,created_at) VALUES(?,?,?,?)', [randomUUID(), action, subject, new Date().toISOString()]); }
  async upsert(kind: Kind, input: unknown, create: boolean) {
    const parsed = schemas[kind].parse(input);
    return this.db.transaction(async tx => {
      const catalog = await this.catalog(tx), list = catalog[kind] as any[];
      const index = list.findIndex(item => item.id === parsed.id), existing = list[index];
      if (create && existing) throw new AppError(409, '资源 ID 已存在');
      if (!create && !existing) throw new AppError(404, '资源不存在');
      if(create&&kind==='flights'&&(await tx.query('SELECT version FROM flight_revisions WHERE flight_id=? LIMIT 1',[parsed.id])).length)throw new AppError(409,'该飞行时刻 ID 已有历史记录，请使用新的 ID');
      if (existing && existing.version !== parsed.version) throw new AppError(409, '资料已被其他人修改，请刷新后重试');
      const item = { ...parsed, version: existing ? existing.version + 1 : 1 };
      if(kind==='nodes'&&(existing?.airportId||(item as any).airportId))throw new AppError(400,'该节点由机场资料管理，请在机场分类中编辑');
      if (index >= 0) list[index] = item; else list.push(item);
      let generatedNode;
      if(kind==='airports'){
        const i=catalog.nodes.findIndex(n=>n.id===item.id),old=catalog.nodes[i];
        if(old&&!old.airportId)throw new AppError(409,'机场 ID 与已有普通节点冲突');
        generatedNode=airportNode({...item,version:old?old.version+1:1} as Airport);
        if(i<0)catalog.nodes.push(generatedNode);else catalog.nodes[i]=generatedNode;
      }
      validateCatalog(catalog);
      await tx.query('INSERT INTO resources(kind,id,version,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at', [kind, item.id, item.version, JSON.stringify(item), new Date().toISOString()]);
      if(generatedNode)await tx.query('INSERT INTO resources(kind,id,version,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at',['nodes',generatedNode.id,generatedNode.version,JSON.stringify(generatedNode),new Date().toISOString()]);
      if(kind==='flights')await tx.query('INSERT INTO flight_revisions(flight_id,version,payload,created_at) VALUES(?,?,?,?)',[item.id,item.version,JSON.stringify(item),new Date().toISOString()]);
      await this.audit(tx, create ? 'resource.create' : 'resource.update', `${kind}/${item.id}`);
      return item;
    });
  }
  async remove(kind: Kind, id: string, version: number) {
    return this.db.transaction(async tx => {
      const catalog = await this.catalog(tx), list = catalog[kind] as any[];
      const existing = list.find(item => item.id === id);
      if (!existing) throw new AppError(404, '资源不存在');
      if(kind==='nodes'&&existing.airportId)throw new AppError(400,'该节点由机场资料管理，请在机场分类中删除');
      if (existing.version !== version) throw new AppError(409, '资料版本已变化，请刷新');
      (catalog[kind] as any[]) = list.filter(item => item.id !== id);
      if(kind==='airports')catalog.nodes=catalog.nodes.filter(n=>n.airportId!==id);
      validateCatalog(catalog);
      await tx.query('DELETE FROM resources WHERE kind=? AND id=?', [kind, id]);
      if(kind==='airports')await tx.query('DELETE FROM resources WHERE kind=? AND id=?',['nodes',id]);
      await this.audit(tx, 'resource.delete', `${kind}/${id}`);
    });
  }
  async importCatalog(input: Record<string, unknown[]>, demo = false) {
    const incoming = emptyCatalog();
    for (const kind of kinds) incoming[kind] = (input[kind] ?? []).map(item => schemas[kind].parse(item)) as any;
    for(const airport of incoming.airports){const node=incoming.nodes.find(n=>n.id===airport.id);if(!node)incoming.nodes.push(airportNode(airport));}
    return this.db.transaction(async tx => {
      const current = await this.catalog(tx);
      if (demo && kinds.some(k => current[k].length)) throw new AppError(409, '示例数据只能导入到空资源库');
      for (const kind of kinds) {
        const seen = new Set<string>();
        for (const item of incoming[kind]) {
          if (seen.has(item.id)) throw new AppError(400, `导入文件 ${kind} 存在重复 ID`);
          seen.add(item.id);
          if (current[kind].some(v => v.id === item.id)) throw new AppError(409, `${kind}/${item.id} 已存在。导入只新增，请使用编辑功能更新`);
          (current[kind] as any[]).push(item);
        }
      }
      validateCatalog(current);
      for(const flight of incoming.flights)if((await tx.query('SELECT version FROM flight_revisions WHERE flight_id=? LIMIT 1',[flight.id])).length)throw new AppError(409,'导入时刻 ID 已有历史记录，请使用新的 ID 或编辑现有时刻');
      for (const kind of kinds) for (const row of incoming[kind]) await tx.query('INSERT INTO resources(kind,id,version,payload,updated_at) VALUES(?,?,?,?,?)', [kind, row.id, 1, JSON.stringify({ ...row, version: 1 }), new Date().toISOString()]);
      for(const flight of incoming.flights)await tx.query('INSERT INTO flight_revisions(flight_id,version,payload,created_at) VALUES(?,?,?,?)',[flight.id,1,JSON.stringify({...flight,version:1}),new Date().toISOString()]);
      await this.audit(tx, demo ? 'catalog.demo' : 'catalog.import', String(kinds.reduce((n,k) => n + incoming[k].length, 0)));
      return current;
    });
  }
  async saveDemand(request: Demand) { const id = randomUUID(); await this.db.query('INSERT INTO demands(id,payload,created_at) VALUES(?,?,?)', [id, JSON.stringify(request), new Date().toISOString()]); return id; }
  async savePlan(input: { request: Demand; laneIds: string[]; title: string; notes: string; groupId?: string; expectedVersion?: number }, planningContext?: PlanningContext) {
    return this.db.transaction(async tx => {
      const catalog = await this.catalog(tx);
      const candidate = evaluatePath(catalog, input.request, input.laneIds, planningContext);
      const groupId = input.groupId ?? randomUUID();
      const previous = await tx.query('SELECT version FROM plan_versions WHERE group_id=? ORDER BY version DESC LIMIT 1', [groupId]);
      const latest = previous[0]?.version ?? 0;
      if (input.groupId && !latest) throw new AppError(404, '原方案不存在');
      if (latest !== (input.expectedVersion ?? 0)) throw new AppError(409, '方案已有新版本，请刷新后重试');
      const saved: SavedPlan = { id: randomUUID(), groupId, version: latest + 1, title: input.title, notes: input.notes, createdAt: new Date().toISOString(), request: input.request, candidate, catalog };
      await tx.query('INSERT INTO plan_versions(id,group_id,version,payload,created_at) VALUES(?,?,?,?,?)', [saved.id, groupId, saved.version, JSON.stringify(saved), saved.createdAt]);
      await this.audit(tx, 'plan.save', saved.id);
      return saved;
    });
  }
  async plans() { return (await this.db.query('SELECT payload FROM plan_versions ORDER BY created_at DESC LIMIT 500')).map(row => { const p = upgradePlanLocation(JSON.parse(row.payload)); const { catalog, ...rest } = p; return rest; }); }
  async plan(id: string): Promise<SavedPlan> { const rows = await this.db.query('SELECT payload FROM plan_versions WHERE id=?', [id]); if (!rows.length) throw new AppError(404, '方案不存在'); return upgradePlanLocation(JSON.parse(rows[0].payload)); }
}
