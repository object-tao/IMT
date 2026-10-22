import { createReadStream, createWriteStream, readFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const manifest=JSON.parse(readFileSync(resolve('assets/geography/manifest.json'),'utf8'));
const target=resolve(process.env.GEO_DATABASE_FILE ?? 'assets/geography/world.sqlite');
mkdirSync(dirname(target),{recursive:true});
function matches(path:string){
  if(!existsSync(path))return false;
  const db=new DatabaseSync(path,{readOnly:true});
  try{const data=JSON.parse(String(db.prepare('SELECT value FROM metadata WHERE key=?').get('dataset')?.value));return data.builtAt===manifest.builtAt && data.cities===manifest.cities;}
  catch{return false;}finally{db.close();}
}
if(matches(target)){console.log(`Global geography ready: ${manifest.countries} countries/territories, ${manifest.cities.toLocaleString()} populated places.`);process.exit(0);}
const archive=`${target}.${process.pid}.download.gz`,next=`${target}.${process.pid}.next`;
try{
  console.log(`Downloading pinned GeoNames snapshot (${Math.ceil(manifest.compressedBytes/1e6)} MB)…`);
  const response=await fetch(manifest.url,{signal:AbortSignal.timeout(20*60*1000)});
  if(!response.ok || !response.body)throw new Error(`Geography download failed: HTTP ${response.status}`);
  const hash=createHash('sha256');
  await pipeline(Readable.fromWeb(response.body as any),new Transform({transform(chunk,_encoding,callback){hash.update(chunk);callback(null,chunk);}}),createWriteStream(archive,{flags:'wx'}));
  if(hash.digest('hex')!==manifest.sha256)throw new Error('Geography checksum mismatch; refusing to install');
  await pipeline(createReadStream(archive),createGunzip(),createWriteStream(next,{flags:'wx'}));
  if(!matches(next))throw new Error('Geography metadata does not match the pinned snapshot');
  renameSync(next,target);
  console.log(`Installed ${manifest.cities.toLocaleString()} populated places in ${target}`);
}finally{for(const file of [archive,next])if(existsSync(file))rmSync(file);}
