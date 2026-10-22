import { createApp } from '../server/app.js';
import { Database } from '../server/database.js';
const { app } = await createApp({ database: new Database({ file: ':memory:' }), clientDir: 'dist/client' });
await app.listen({ port: 3199, host: '127.0.0.1' });
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
