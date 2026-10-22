import { createApp } from './app.js';
const host = process.env.HOST ?? '127.0.0.1';
if ((process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(host)) && (!process.env.AUTH_PASSWORD || process.env.AUTH_PASSWORD.length < 16 || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('非本机或生产环境必须设置至少 16 字符的 AUTH_PASSWORD 和至少 32 字符的 SESSION_SECRET');
}
const { app } = await createApp({ logger: true });
await app.listen({ port: Number(process.env.PORT ?? 3100), host });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); process.exit(0); });
