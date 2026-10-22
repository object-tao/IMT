import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomBytes, createHash, timingSafeEqual, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { Database } from './database.js';
import { Store, AppError } from './store.js';
import { kinds, schemas, requestSchema, nodeSchema,airportSchema } from '../shared/model.js';
import { previewAirImport } from './air-import.js';
import { countries, countryCode } from '../shared/geography.js';
import { Geography } from './geography.js';
import { RoadService } from './road.js';
import { solve, evaluatePath } from '../shared/engine.js';
import { demoCatalog } from '../shared/demo.js';
import { exportDocx, exportHtml } from './export.js';

export async function createApp(options: { database?: Database; geography?: Geography; road?: RoadService; password?: string; secret?: string; secureCookie?: boolean; logger?: boolean; clientDir?: string } = {}) {
  const password = options.password ?? process.env.AUTH_PASSWORD;
  const secret = options.secret ?? process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 5 * 1024 * 1024, requestTimeout: 30000 });
  const db = options.database ?? new Database({ url: process.env.DATABASE_URL, file: process.env.DATABASE_FILE });
  await db.initialize();
  await db.query('CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL)');
  const store = new Store(db);
  const geography=options.geography ?? new Geography();
  const road=options.road ?? new RoadService();
  await store.migrateGeography(geography);
  await app.register(cookie, { secret });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"] } } });
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  const passwordSalt = randomBytes(16);
  const expectedPassword = password ? scryptSync(password, passwordSalt, 64) : undefined;
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const authenticated = async (raw?: string) => {
    if (!password) return true;
    if (!raw) return false;
    const parsed = app.unsignCookie(raw);
    if (!parsed.valid || !parsed.value) return false;
    const rows = await db.query('SELECT expires_at FROM auth_sessions WHERE token_hash=?', [hash(parsed.value)]);
    return !!rows.length && Date.parse(rows[0].expires_at) > Date.now();
  };
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.headers.origin) {
      if (new URL(req.headers.origin).host !== req.headers.host) return reply.code(403).send({ message: '请求来源不匹配' });
    }
    if (['/api/health', '/api/session', '/api/login'].includes(req.url.split('?')[0])) return;
    if (!await authenticated(req.cookies.imt_session)) return reply.code(401).send({ message: '请先登录' });
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ message: err.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；') });
    if (err instanceof AppError) return reply.code(err.statusCode).send({message:err.message});
    const error = err as Error & { statusCode?: number };
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ message: error.message });
    req.log.error(err);
    return reply.code(500).send({ message: '服务处理失败，请检查服务日志' });
  });
  app.get('/api/health', async () => { await db.query('SELECT 1 AS ok'); return { ok: true, version: '0.1.0', database: db.driver }; });
  app.get('/api/session', async req => ({ authenticated: await authenticated(req.cookies.imt_session), authRequired: !!password }));
  app.post('/api/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password: supplied } = z.object({ password: z.string().max(256) }).parse(req.body);
    if (expectedPassword && !timingSafeEqual(scryptSync(supplied, passwordSalt, 64), expectedPassword)) throw new AppError(401, '访问密码不正确');
    const token = randomBytes(32).toString('hex');
    await db.query('DELETE FROM auth_sessions WHERE expires_at<?', [new Date().toISOString()]);
    await db.query('INSERT INTO auth_sessions(token_hash,expires_at) VALUES(?,?)', [hash(token), new Date(Date.now() + 8 * 3600000).toISOString()]);
    reply.setCookie('imt_session', token, { signed: true, httpOnly: true, sameSite: 'strict', secure: options.secureCookie ?? process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 8 * 3600 });
    return { ok: true };
  });
  app.post('/api/logout', async (req, reply) => {
    const value = req.cookies.imt_session ? app.unsignCookie(req.cookies.imt_session).value : null;
    if (value) await db.query('DELETE FROM auth_sessions WHERE token_hash=?', [hash(value)]);
    reply.clearCookie('imt_session', { path: '/' }); return { ok: true };
  });
  app.get('/api/catalog', async () => store.catalog());
  const bindResource=(kind:string,input:any)=>{
    if(kind==='nodes')return geography.bindNode(nodeSchema.parse(input),true);
    if(kind==='airports'){const airport=airportSchema.parse(input),bound=geography.bindNode({...airport,type:'airport'},true);return {...airport,city:bound.city,cityId:bound.cityId};}
    return input;
  };
  app.post('/api/air-import/preview',{bodyLimit:8*1024*1024},async req=>previewAirImport(req.body,await store.catalog()));
  app.get('/api/flights/:id/history',async req=>(await db.query('SELECT payload,created_at FROM flight_revisions WHERE flight_id=? ORDER BY version DESC',[(req.params as {id:string}).id])).map(row=>({flight:JSON.parse(row.payload),changedAt:row.created_at})));
  app.get('/api/road/status',async()=>road.status());
  app.post('/api/road/query',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>road.query(req.body,geography,db));
  app.get('/api/geo/countries',async()=>({items:countries,metadata:geography.metadata(),available:geography.available}));
  app.get('/api/geo/cities',async req=>{
    const query=z.object({country:z.string().length(2),q:z.string().max(100).default(''),offset:z.coerce.number().int().min(0).max(10000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(40)}).parse(req.query);
    if(!countryCode(query.country))throw new AppError(400,'无效国家');
    return geography.search(query.country,query.q,query.offset,query.limit);
  });
  for (const kind of kinds) {
    app.post(`/api/resources/${kind}`, async (req, reply) => reply.code(201).send(await store.upsert(kind,bindResource(kind,req.body), true)));
    app.put(`/api/resources/${kind}/:id`, async req => {
      const { id } = req.params as { id: string };
      if ((req.body as any)?.id !== id) throw new AppError(400, '资源 ID 不一致');
      return store.upsert(kind,bindResource(kind,req.body), false);
    });
    app.delete(`/api/resources/${kind}/:id`, async req => {
      const { id } = req.params as { id: string }, { version } = z.object({ version: z.coerce.number().int().positive() }).parse(req.query);
      await store.remove(kind, id, version); return { ok: true };
    });
  }
  app.post('/api/catalog/import', async req => {
    const body = z.object(Object.fromEntries(kinds.map(k => [k, z.array(z.unknown()).max(10000).optional()]))).strict().parse(req.body);
    const imported=body as Record<string, unknown[]>;
    if(imported.nodes)imported.nodes=imported.nodes.map(node=>geography.bindNode(nodeSchema.parse(node),true));
    if(imported.airports)imported.airports=imported.airports.map(airport=>bindResource('airports',airport));
    return store.importCatalog(imported);
  });
  app.post('/api/catalog/demo', async () => {const demo=demoCatalog();demo.nodes=demo.nodes.map(n=>geography.bindNode(nodeSchema.parse(n)));return store.importCatalog(demo,true);});
  app.post('/api/solve', async req => {
    const request = geography.bindDemand(requestSchema.parse(req.body));
    const demandId = await store.saveDemand(request);
    const catalog = await store.catalog();
    return { ...solve(catalog, request, geography.planningContext(request, catalog)), demandId };
  });
  app.post('/api/evaluate', async req => {
    const body = z.object({ request: requestSchema, laneIds: z.array(z.string()).min(1).max(8) }).parse(req.body);
    try {
      const catalog = await store.catalog(), request = geography.bindDemand(body.request);
      return evaluatePath(catalog, request, body.laneIds, geography.planningContext(request, catalog));
    }
    catch (e) { throw new AppError(400, (e as Error).message); }
  });
  app.get('/api/plans', async () => store.plans());
  app.get('/api/plans/:id', async req => store.plan((req.params as { id: string }).id));
  app.post('/api/plans', async req => {
    const body = z.object({ request: requestSchema, laneIds: z.array(z.string()).min(1).max(8), title: z.string().trim().min(1).max(200), notes: z.string().max(2000).default(''), groupId: z.string().optional(), expectedVersion: z.number().int().nonnegative().optional() }).parse(req.body);
    try {
      const request = geography.bindDemand(body.request), catalog = await store.catalog();
      return await store.savePlan({...body,request},geography.planningContext(request,catalog));
    } catch (e) { if (e instanceof AppError) throw e; throw new AppError(400, (e as Error).message); }
  });
  app.get('/api/plans/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string }, query = z.object({ format: z.enum(['docx', 'html']), audience: z.enum(['internal', 'customer']) }).parse(req.query);
    const plan = await store.plan(id), internal = query.audience === 'internal';
    if (query.format === 'html') return reply.type('text/html; charset=utf-8').send(exportHtml(plan, internal));
    return reply.header('Content-Disposition', `attachment; filename="IMT-plan-v${plan.version}.docx"`).type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(await exportDocx(plan, internal));
  });
  const clientDir = resolve(options.clientDir ?? 'dist/client');
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ message: '接口不存在' }) : reply.sendFile('index.html'));
  }
  app.addHook('onClose', async () => {geography.close();await db.close();});
  return { app, store, db };
}
