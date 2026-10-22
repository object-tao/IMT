import { describe,it,expect,beforeEach,afterEach } from 'vitest';
import { Database } from '../server/database.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { airFixture,importRows,importOptions } from './air-fixture.js';
let db:Database,store:Store;
beforeEach(async()=>{db=new Database(process.env.TEST_DATABASE_URL?{url:process.env.TEST_DATABASE_URL}:{file:':memory:'});await db.initialize();store=new Store(db);if(process.env.TEST_DATABASE_URL)for(const table of ['resources','flight_revisions','plan_versions','audit_events','demands'])await db.query(`DELETE FROM ${table}`);});
afterEach(async()=>db.close());
describe('机场与飞行时刻持久化',()=>{
  it('机场自动派生共享节点，禁止节点直接修改和重复 IATA，关联中的机场不能删除',async()=>{
    const {catalog:c}=airFixture();await store.importCatalog(c);
    const a=c.airports[0];await store.upsert('airports',{...a,name:'测试机场改名'},false);
    const current=await store.catalog();expect(current.nodes.find(n=>n.id===a.id)?.name).toContain('测试机场改名');
    await expect(store.upsert('nodes',current.nodes.find(n=>n.id===a.id),false)).rejects.toThrow('机场资料管理');
    await expect(store.upsert('airports',{...a,id:'duplicate'},true)).rejects.toThrow('已存在');expect((await store.catalog()).airports).toHaveLength(2);
    await expect(store.remove('airports',a.id,2)).rejects.toThrow('起止节点不存在');
  });
  it('时刻修订有历史、并发编辑拒绝过时版本，已存方案快照不改写',async()=>{
    const {catalog:c,flight:f,request,path}=airFixture();c.flights=[f];await store.importCatalog(c);
    const saved=await store.savePlan({request,laneIds:path,title:'班次快照测试',notes:''});
    const changes=await Promise.allSettled([store.upsert('flights',{...f,offBlockTime:'03:05'},false),store.upsert('flights',{...f,offBlockTime:'03:10'},false)]);expect(changes.filter(c=>c.status==='fulfilled')).toHaveLength(1);
    const history=await db.query('SELECT payload FROM flight_revisions WHERE flight_id=? ORDER BY version',[f.id]);expect(history).toHaveLength(2);expect(JSON.parse(history[0].payload).offBlockTime).toBe('03:00');
    expect((await store.plan(saved.id)).candidate.legs[1].flight?.rule.offBlockTime).toBe('03:00');
    await store.remove('flights',f.id,2);expect((await db.query('SELECT version FROM flight_revisions WHERE flight_id=?',[f.id]))).toHaveLength(2);
    await expect(store.upsert('flights',f,true)).rejects.toThrow('历史记录');expect((await store.plan(saved.id)).candidate.legs[1].flight?.rule.id).toBe(f.id);
  });
  it('错误关联或重叠时刻使整批回滚，版本记录也不残留',async()=>{
    const {catalog:c,flight:f}=airFixture();c.flights=[f,{...f,id:'bad-flight',laneId:'missing'}];await expect(store.importCatalog(c)).rejects.toThrow('关联航空航线');expect((await store.catalog()).airports).toHaveLength(0);expect(await db.query('SELECT * FROM flight_revisions')).toEqual([]);
    c.flights=[f,{...f,id:'overlap'}];await expect(store.importCatalog(c)).rejects.toThrow('重叠');expect((await store.catalog()).suppliers).toHaveLength(0);
  });
  it('API 可预览后原子提交、读取修订；没有时刻的机场航线可保存',async()=>{
    // Isolated SQLite here; the other tests exercise either SQLite or the CI PostgreSQL service.
    const {app}=await createApp({database:new Database({file:':memory:'})});
    try{
      const {catalog:c}=airFixture();c.lanes=[];c.nodes=[];
      const seed=await app.inject({method:'POST',url:'/api/catalog/import',payload:c});expect(seed.statusCode).toBe(200);
      const preview=await app.inject({method:'POST',url:'/api/air-import/preview',payload:{...importOptions,rows:importRows}});expect(preview.statusCode).toBe(200);expect(preview.json().newLanes).toBe(1);
      const commit=await app.inject({method:'POST',url:'/api/catalog/import',payload:preview.json().catalog});expect(commit.statusCode).toBe(200);expect(commit.json().flights).toHaveLength(3);
      const f=commit.json().flights[0];expect((await app.inject(`/api/flights/${f.id}/history`)).json()).toHaveLength(1);
      const again=await app.inject({method:'POST',url:'/api/air-import/preview',payload:{...importOptions,rows:importRows}});expect(again.json().existing).toBe(3);expect(again.json().newFlights).toBe(0);
    }finally{await app.close();}
  });
});
