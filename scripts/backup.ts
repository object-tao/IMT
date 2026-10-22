import { resolve } from 'node:path';
import { Database } from '../server/database.js';
const db = new Database({ url: process.env.DATABASE_URL, file: process.env.DATABASE_FILE });
const target = resolve('backups', `imt-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
try { await db.sqliteBackup(target); console.log(`已备份至 ${target}`); } finally { await db.close(); }
