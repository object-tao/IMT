import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Database } from '../server/database.js';
import { Store } from '../server/store.js';
import { demoCatalog, demoDemand } from '../shared/demo.js';
let db: Database, store: Store;
beforeEach(async () => {
  db = new Database(process.env.TEST_DATABASE_URL ? {url:process.env.TEST_DATABASE_URL} : {file:':memory:'});
  await db.initialize(); store = new Store(db);
  if (process.env.TEST_DATABASE_URL) { await db.query('DELETE FROM resources'); await db.query('DELETE FROM plan_versions'); await db.query('DELETE FROM demands'); await db.query('DELETE FROM audit_events'); }
});
afterEach(async () => db.close());
describe('资源及方案持久化', () => {
  it('资源库事务导入，任何关联错误均整批回滚', async () => {
    const catalog = demoCatalog(); catalog.lanes[0].supplierId='missing';
    await expect(store.importCatalog(catalog)).rejects.toThrow('供应商不存在');
    expect((await store.catalog()).suppliers).toHaveLength(0);
  });
  it('并发编辑会拒绝过时版本，引用中的资源不能删除', async () => {
    await store.importCatalog(demoCatalog()); const supplier = (await store.catalog()).suppliers[0];
    const results = await Promise.allSettled([store.upsert('suppliers',{...supplier,name:'修改 A'},false),store.upsert('suppliers',{...supplier,name:'修改 B'},false)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await store.catalog()).suppliers.find(s => s.id === supplier.id)!;
    await expect(store.remove('suppliers',supplier.id,current.version)).rejects.toThrow('供应商不存在');
  });
  it('保存版本快照，资源变化不会修改历史方案', async () => {
    await store.importCatalog(demoCatalog());
    const input = {request:demoDemand(),laneIds:['l-dom','l-transfer','l-air-a','l-uk-a'],title:'测试方案',notes:'内部备注'};
    const v1 = await store.savePlan(input), rate = (await store.catalog()).rates.find(r => r.id === 'r-dom')!;
    await store.upsert('rates',{...rate,price:rate.price + 10},false);
    const v2 = await store.savePlan({...input,groupId:v1.groupId,expectedVersion:1});
    expect(v2.version).toBe(2); expect(v2.candidate.knownCny).toBeGreaterThan(v1.candidate.knownCny);
    expect((await store.plan(v1.id)).candidate.knownCny).toBe(v1.candidate.knownCny);
    await expect(store.savePlan({...input,groupId:v1.groupId,expectedVersion:1})).rejects.toThrow('已有新版本');
  });
  it('不覆盖已有资源，也不允许示例数据混入非空库', async () => {
    await store.importCatalog(demoCatalog());
    await expect(store.importCatalog(demoCatalog())).rejects.toThrow('已存在');
    await expect(store.importCatalog(demoCatalog(),true)).rejects.toThrow('空资源库');
  });
});
