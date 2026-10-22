import { randomUUID } from 'node:crypto';
import { Database, type Sql } from './database.js';
import { schemas, kinds, emptyCatalog, type Kind, type Catalog, type SavedPlan, type Demand } from '../shared/model.js';
import { evaluatePath } from '../shared/engine.js';

export class AppError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
export function validateCatalog(catalog: Catalog) {
  for (const kind of kinds) {
    const ids = new Set<string>();
    for (const item of catalog[kind]) { if (ids.has(item.id)) throw new AppError(400, `${kind} 存在重复 ID：${item.id}`); ids.add(item.id); }
  }
  for (const lane of catalog.lanes) {
    if (!catalog.suppliers.some(s => s.id === lane.supplierId)) throw new AppError(400, `${lane.name} 的供应商不存在`);
    if (![lane.from, lane.to].every(id => catalog.nodes.some(n => n.id === id))) throw new AppError(400, `${lane.name} 的起止节点不存在`);
  }
  for (const rate of catalog.rates) if (!catalog.lanes.some(l => l.id === rate.laneId)) throw new AppError(400, `${rate.name} 的线路不存在`);
}
export class Store {
  constructor(public db: Database) {}
  async catalog(tx: Sql = this.db): Promise<Catalog> {
    const rows = await tx.query('SELECT kind,payload FROM resources ORDER BY kind,id');
    const result = emptyCatalog();
    for (const row of rows) result[row.kind as Kind].push(JSON.parse(row.payload));
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
      if (existing && existing.version !== parsed.version) throw new AppError(409, '资料已被其他人修改，请刷新后重试');
      const item = { ...parsed, version: existing ? existing.version + 1 : 1 };
      if (index >= 0) list[index] = item; else list.push(item);
      validateCatalog(catalog);
      await tx.query('INSERT INTO resources(kind,id,version,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at', [kind, item.id, item.version, JSON.stringify(item), new Date().toISOString()]);
      await this.audit(tx, create ? 'resource.create' : 'resource.update', `${kind}/${item.id}`);
      return item;
    });
  }
  async remove(kind: Kind, id: string, version: number) {
    return this.db.transaction(async tx => {
      const catalog = await this.catalog(tx), list = catalog[kind] as any[];
      const existing = list.find(item => item.id === id);
      if (!existing) throw new AppError(404, '资源不存在');
      if (existing.version !== version) throw new AppError(409, '资料版本已变化，请刷新');
      (catalog[kind] as any[]) = list.filter(item => item.id !== id);
      validateCatalog(catalog);
      await tx.query('DELETE FROM resources WHERE kind=? AND id=?', [kind, id]);
      await this.audit(tx, 'resource.delete', `${kind}/${id}`);
    });
  }
  async importCatalog(input: Record<string, unknown[]>, demo = false) {
    const incoming = emptyCatalog();
    for (const kind of kinds) incoming[kind] = (input[kind] ?? []).map(item => schemas[kind].parse(item)) as any;
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
      for (const kind of kinds) for (const row of incoming[kind]) await tx.query('INSERT INTO resources(kind,id,version,payload,updated_at) VALUES(?,?,?,?,?)', [kind, row.id, 1, JSON.stringify({ ...row, version: 1 }), new Date().toISOString()]);
      await this.audit(tx, demo ? 'catalog.demo' : 'catalog.import', String(kinds.reduce((n,k) => n + incoming[k].length, 0)));
      return current;
    });
  }
  async saveDemand(request: Demand) { const id = randomUUID(); await this.db.query('INSERT INTO demands(id,payload,created_at) VALUES(?,?,?)', [id, JSON.stringify(request), new Date().toISOString()]); return id; }
  async savePlan(input: { request: Demand; laneIds: string[]; title: string; notes: string; groupId?: string; expectedVersion?: number }) {
    return this.db.transaction(async tx => {
      const catalog = await this.catalog(tx);
      const candidate = evaluatePath(catalog, input.request, input.laneIds);
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
  async plans() { return (await this.db.query('SELECT payload FROM plan_versions ORDER BY created_at DESC LIMIT 500')).map(row => { const p: SavedPlan = JSON.parse(row.payload); const { catalog, ...rest } = p; return rest; }); }
  async plan(id: string): Promise<SavedPlan> { const rows = await this.db.query('SELECT payload FROM plan_versions WHERE id=?', [id]); if (!rows.length) throw new AppError(404, '方案不存在'); return JSON.parse(rows[0].payload); }
}
