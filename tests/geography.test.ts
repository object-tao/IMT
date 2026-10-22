import { describe,it,expect } from 'vitest';
import { Geography } from '../server/geography.js';
import { countries,countryCode,sameCity } from '../shared/geography.js';
import { requestSchema } from '../shared/model.js';
import { demoCatalog,demoDemand } from '../shared/demo.js';
import { solve,evaluatePath } from '../shared/engine.js';
import { Database } from '../server/database.js';
import { Store } from '../server/store.js';
describe('国家与全球城市库',()=>{
  it('国家字典包含全球来源国家及常用别名',()=>{
    expect(countries.length).toBeGreaterThanOrEqual(240);
    expect(countryCode('中国')).toBe('CN');expect(countryCode('UK')).toBe('GB');expect(countryCode('United States')).toBe('US');
    expect(countryCode('无效国家')).toBeUndefined();
  });
  it('同名城市按国家和城市 ID 区分',()=>{
    expect(sameCity({country:'GB',city:'London'},{country:'CA',city:'London'})).toBe(false);
    expect(sameCity({country:'US',city:'Springfield',cityId:'1'},{country:'US',city:'Springfield',cityId:'2'})).toBe(false);
    expect(sameCity({country:'US',city:'Springfield'},{country:'US',city:'Springfield',cityId:'1'})).toBe(false);
    expect(requestSchema.safeParse({...demoDemand(),originCountry:'CA',originCity:'London',originCityId:undefined,destinationCountry:'GB',destinationCity:'London',destinationCityId:undefined}).success).toBe(true);
    expect(requestSchema.safeParse({...demoDemand(),originCountry:'ZZ'}).success).toBe(false);
  });
  it('国家参与起止点筛选，不能把不同国家同名城市作为接驳',()=>{
    const catalog=demoCatalog();catalog.nodes=[{id:'a',version:1,name:'美国覆盖点',country:'US',city:'London',type:'city',timeZone:'America/New_York'},{id:'b',version:1,name:'英国覆盖点',country:'GB',city:'London',type:'city',timeZone:'Europe/London'}];catalog.lanes=[];
    const request={...demoDemand(),originCountry:'US',originCity:'London',originCityId:undefined,destinationCountry:'GB',destinationCity:'London',destinationCityId:undefined};
    expect(solve(catalog,request).candidates).toHaveLength(0);
    expect(()=>evaluatePath(catalog,request,['gap|a|b'])).toThrow('无效');
    expect(solve(demoCatalog(),{...demoDemand(),originCountry:'US'}).candidates).toHaveLength(0);
  });
  it('全球数据不设人口门槛，支持中文、英文、国家过滤及分页',()=>{
    const geo=new Geography();
    try{
      expect(geo.available).toBe(true);expect(geo.metadata()!.cities).toBeGreaterThan(1000000);
      expect(geo.search('CN','上海').items.some(c=>c.id==='1796236')).toBe(true);
      expect(geo.search('GB','London').items[0].id).toBe('2643743');
      expect(geo.search('CA','London').items.every(c=>c.country==='CA')).toBe(true);
      const first=geo.search('US','',0,3),next=geo.search('US','',first.nextOffset!,3);
      expect(first.hasMore).toBe(true);expect(new Set([...first.items,...next.items].map(c=>c.id)).size).toBe(6);
      expect(geo.get('1796236')!.timeZone).toBe('Asia/Shanghai');
      expect(geo.search('CN','"* OR country:US').items.every(c=>c.country==='CN')).toBe(true);
    }finally{geo.close();}
  });
  it('拒绝城市 ID 与国家错配，不能用名称覆盖真实归属',()=>{
    const geo=new Geography();try{expect(()=>geo.bindDemand({...demoDemand(),originCountry:'US',originCity:'纽约',originCityId:'1796236'})).toThrow('起运城市');}finally{geo.close();}
  });
  it('兼容旧节点与历史方案，历史快照不被改写',async()=>{
    const db=new Database({file:':memory:'}),geo=new Geography();await db.initialize();const store=new Store(db);
    try{
      await store.importCatalog(demoCatalog());
      const plan=await store.savePlan({request:demoDemand(),laneIds:['l-dom','l-transfer','l-air-a','l-uk-a'],title:'旧方案',notes:''});
      const old=JSON.parse(JSON.stringify(plan));delete old.request.originCountry;delete old.request.destinationCountry;
      const original=JSON.stringify(old);await db.query('UPDATE plan_versions SET payload=? WHERE id=?',[original,plan.id]);
      await store.migrateGeography(geo);
      expect((await store.catalog()).nodes.find(n=>n.id==='sh')!.cityId).toBe('1796236');
      expect((await store.plan(plan.id)).request.originCountry).toBe('CN');
      expect((await db.query('SELECT payload FROM plan_versions WHERE id=?',[plan.id]))[0].payload).toBe(original);
    }finally{geo.close();await db.close();}
  });
});
