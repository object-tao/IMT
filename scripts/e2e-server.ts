import { createApp } from '../server/app.js';
import { Database } from '../server/database.js';
import { RoadService } from '../server/road.js';
const { app } = await createApp({ database: new Database({ file: ':memory:' }), clientDir: 'dist/client', road:new RoadService({amapKey:'',hereKey:''}) });
await app.listen({ port: 3199, host: '127.0.0.1' });
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
