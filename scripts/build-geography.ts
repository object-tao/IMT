import { DatabaseSync } from 'node:sqlite';
import { createReadStream, createWriteStream, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';

const input = resolve(process.argv[2] ?? '../work/geo-source');
const output = resolve('assets/geography'); mkdirSync(output,{recursive:true});
const zh = new Intl.DisplayNames(['zh-Hans'],{type:'region'});
const en = new Intl.DisplayNames(['en'],{type:'region'});
const countries = readFileSync(join(input,'countryInfo.txt'),'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => {
  const c=l.split('\t');
  return { code:c[0],name:zh.of(c[0]) ?? c[4],nameEn:c[4],iso3:c[1],capital:c[5],aliases:[en.of(c[0]) ?? c[4],c[4],c[1]].filter(Boolean) };
}).filter(c => /^[A-Z]{2}$/.test(c.code));
if(countries.length < 240) throw new Error('Country source is incomplete');
writeFileSync('shared/countries.json',JSON.stringify(countries,null,2)+'\n');
if(process.argv.includes('--countries-only')) process.exit(0);
const allowed=new Set(countries.map(c=>c.code));
const admins=new Map(readFileSync(join(input,'admin1CodesASCII.txt'),'utf8').split(/\r?\n/).filter(Boolean).map(l=>{const p=l.split('\t');return [p[0],p[1]];}));
const file=join(output,'world.next.sqlite');
const db=new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-64000;
CREATE TABLE cities (id TEXT PRIMARY KEY, country TEXT NOT NULL, name TEXT NOT NULL, ascii_name TEXT NOT NULL, display_name TEXT NOT NULL, admin1 TEXT NOT NULL, timezone TEXT NOT NULL, population INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, feature_code TEXT NOT NULL, aliases TEXT NOT NULL);
CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
const insert=db.prepare('INSERT INTO cities VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
let count=0,scanned=0;const seenCountries=new Set<string>();
const stream = await new Promise<NodeJS.ReadableStream>((res,rej)=>{
  yauzl.open(join(input,'allCountries.zip'),{lazyEntries:true},(err,zip)=>{
    if(err || !zip) return rej(err);
    zip.on('error',rej);zip.on('entry',entry=>{
      if(entry.fileName!=='allCountries.txt')return zip.readEntry();
      zip.openReadStream(entry,(error,stream)=>error || !stream ? rej(error) : res(stream));
    });zip.readEntry();
  });
});
db.exec('BEGIN');
for await (const line of createInterface({input:stream,crlfDelay:Infinity})) {
  scanned++;const p=line.split('\t');
  if(p[6]!=='P' || !allowed.has(p[8]))continue;
  // Keep all populated-place records, including small settlements; no population cutoff.
  const aliases=[...new Set([p[1],p[2],...p[3].split(',')])].filter(Boolean);
  const display=p[1];
  insert.run(p[0],p[8],p[1],p[2],display,admins.get(`${p[8]}.${p[10]}`) ?? p[10],p[17],Number(p[14])||0,Number(p[4]),Number(p[5]),p[7],aliases.join('\n'));
  count++;seenCountries.add(p[8]);
  if(count%50000===0){db.exec('COMMIT; BEGIN');console.log(`Imported ${count.toLocaleString()} populated places (${scanned.toLocaleString()} source records)`);}
}
db.exec('COMMIT');
console.log('Building country and full-text indexes…');
db.exec(`CREATE INDEX city_country_population ON cities(country,population DESC,id);
CREATE VIRTUAL TABLE city_search USING fts5(country,aliases, content='cities',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');
INSERT INTO city_search(city_search) VALUES('rebuild');`);
const metadata={source:'GeoNames',sourceUrl:'https://download.geonames.org/export/dump/',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',builtAt:new Date().toISOString(),countries:countries.length,cities:count,countriesWithCities:seenCountries.size,scope:'All GeoNames feature-class P populated places; no population threshold. Source coverage is not guaranteed complete.'};
db.prepare('INSERT INTO metadata VALUES(?,?)').run('dataset',JSON.stringify(metadata));
db.exec('PRAGMA optimize');db.close();
renameSync(file,join(output,'world.sqlite'));
await pipeline(createReadStream(join(output,'world.sqlite')),createGzip({level:6}),createWriteStream(join(output,'world.sqlite.gz')));
const hash=createHash('sha256');for await(const chunk of createReadStream(join(output,'world.sqlite.gz')))hash.update(chunk);
writeFileSync(join(output,'build-manifest.json'),JSON.stringify({...metadata,sha256:hash.digest('hex'),compressedBytes:statSync(join(output,'world.sqlite.gz')).size},null,2)+'\n');
console.log(metadata);
