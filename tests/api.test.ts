import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createApp } from '../server/app.js';
import { Database } from '../server/database.js';
import { demoDemand } from '../shared/demo.js';
describe('API 与文档隔离', () => {
  it('登录保护、登出撤销、资源导入、计算、保存与客户文档导出', async () => {
    const {app} = await createApp({ database:new Database({file:':memory:'}),password:'test-password-long-enough',secret:'test-session-secret-with-32-characters' });
    try {
      expect((await app.inject('/api/catalog')).statusCode).toBe(401);
      expect((await app.inject({method:'POST',url:'/api/login',payload:{password:'incorrect'}})).statusCode).toBe(401);
      const login = await app.inject({method:'POST',url:'/api/login',payload:{password:'test-password-long-enough'}});
      const cookies = {imt_session:login.cookies[0].value};
      expect((await app.inject({method:'POST',url:'/api/catalog/demo',cookies,payload:{}})).statusCode).toBe(200);
      const solved = await app.inject({method:'POST',url:'/api/solve',cookies,payload:demoDemand()});
      expect(solved.statusCode).toBe(200); expect(solved.json().candidates.length).toBeGreaterThan(0);
      const c = solved.json().candidates[0];
      const saved = await app.inject({method:'POST',url:'/api/plans',cookies,payload:{request:demoDemand(),laneIds:c.legs.map((l:any) => l.laneId),title:'客户运输方案',notes:'SECRET-INTERNAL-NOTE'}});
      expect(saved.statusCode).toBe(200); const id = saved.json().id;
      const customer = await app.inject({url:`/api/plans/${id}/export?format=html&audience=customer`,cookies});
      expect(customer.statusCode).toBe(200); expect(customer.body).not.toContain('SECRET-INTERNAL-NOTE'); expect(customer.body).not.toContain('示例 ·');
      const internal = await app.inject({url:`/api/plans/${id}/export?format=html&audience=internal`,cookies});
      expect(internal.body).toContain('SECRET-INTERNAL-NOTE'); expect(internal.body).toContain('示例 ·');
      const doc = await app.inject({url:`/api/plans/${id}/export?format=docx&audience=customer`,cookies});
      const zip = await JSZip.loadAsync(doc.rawPayload), xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('客户运输方案'); expect(xml).not.toContain('SECRET-INTERNAL-NOTE'); expect(xml).not.toContain('示例 ·');
      expect((await app.inject({method:'POST',url:'/api/solve',cookies,payload:{}})).statusCode).toBe(400);
      await app.inject({method:'POST',url:'/api/logout',cookies,payload:{}});
      expect((await app.inject({url:'/api/catalog',cookies})).statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it('拒绝跨来源写请求', async () => {
    const {app} = await createApp({database:new Database({file:':memory:'})});
    try { expect((await app.inject({method:'POST',url:'/api/catalog/demo',headers:{origin:'https://untrusted.invalid'},payload:{}})).statusCode).toBe(403); }
    finally { await app.close(); }
  });
});
