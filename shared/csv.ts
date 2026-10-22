export function readCsvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === '') quoted = !quoted;
      else throw new Error('CSV 引号格式不正确');
    } else if (!quoted && c === ',') { row.push(field); field = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
export function readCsv(text: string): Record<string, string>[] {
  const rows=readCsvRows(text);
  const header = rows.shift()?.map(h => h.trim()) ?? [];
  if (!header.length || header.some(h => !h) || new Set(header).size !== header.length) throw new Error('CSV 列名为空或重复');
  return rows.map((values, i) => { if (values.length !== header.length) throw new Error(`第 ${i + 2} 行列数与表头不符`); return Object.fromEntries(header.map((h,j) => [h, values[j]])); });
}
export function writeCsv(rows: Record<string, unknown>[]): string {
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const escape = (value: unknown) => {
    let text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Prevent spreadsheet formula execution when resources contain user supplied text.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [headers.map(escape).join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\r\n');
}
const numeric = new Set(['version','transitHours','handlingHours','maxLengthCm','maxWidthCm','maxHeightCm','maxPieceKg','maxShipmentKg','maxShipmentCbm','price','minimum','rounding','volumetricDivisor','toCny','takeoffDayOffset','landingDayOffset','arrivalDayOffset','cutoffHours']);
const structured = new Set(['schedule','capabilities','hazardousClasses','unNumbers','containerTypes','services','bands','surcharges','aliases','weekdays']);
export function csvEntities(text: string) {
  return readCsv(text).map((row,i) => {
    const entity: Record<string, unknown> = { id: row.id || crypto.randomUUID(), version: 1 };
    for (const [key,value] of Object.entries(row)) {
      if (!value.trim()) continue;
      if (numeric.has(key)) entity[key] = Number(value);
      else if (key === 'onDemand'||key==='validityUnknown') { if (!['true','false'].includes(value)) throw new Error(`第 ${i + 2} 行 ${key} 必须为 true 或 false`); entity[key] = value === 'true'; }
      else if (structured.has(key)) { try { entity[key] = JSON.parse(value); } catch { throw new Error(`第 ${i + 2} 行 ${key} 格式不正确`); } }
      else entity[key] = value;
    }
    return entity;
  });
}
