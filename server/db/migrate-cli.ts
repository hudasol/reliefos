import { loadConfig } from '../config.js';
import { openDatabase } from './database.js';
import { migrate } from './migrations.js';

const config = loadConfig();
const db = await openDatabase({
  databaseUrl: config.databaseUrl,
  pgliteDataDir: config.databaseUrl ? null : (config.pgliteDataDir ?? '.data/pglite'),
});
const ran = await migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
await db.close();
