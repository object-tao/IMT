import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cargoFlags, flagNames, modeNames, unitNames, modes, units, type Catalog, type Kind } from '../shared/model';
import { Field, Busy } from './components';
export const kindNames: Record<Kind, string> = { suppliers: '供应商', nodes: '运输节点', lanes: '分段线路', rates: '运价', fx: '汇率' };
const serviceNames = ['出口报关','进口清关','装卸','仓储','保险'];
export function blankResource(kind: Kind, catalog: Catalog): any {
  const base = { id: crypto.randomUUID(), version: 1 };
  const validity = { validFrom: new Date().toISOString().slice(0,10), validTo: `${new Date().getFullYear() + 1}-12-31` };
  switch (kind) {
    case 'suppliers': return { ...base, name: '', contact: '', notes: '' };
    case 'nodes': return { ...base, name: '', city: '', country: '中国', type: 'city', timeZone: 'Asia/Shanghai' };
    case 'lanes': return { ...base, ...validity, name: '', supplierId: catalog.suppliers[0]?.id ?? '', from: catalog.nodes[0]?.id ?? '', to: catalog.nodes[1]?.id ?? '', mode: 'road', transitHours: 24, handlingHours: 0, onDemand: true, capabilities: Object.fromEntries(cargoFlags.map(f => [f,'unknown'])), hazardousClasses: [], unNumbers: [], containerTypes: [], services: serviceNames.map(name => ({ name, status: 'unknown' })), notes: '' };
    case 'rates': return { ...base, ...validity, name: '', laneId: catalog.lanes[0]?.id ?? '', currency: 'CNY', unit: 'kg', price: 0, minimum: 0, rounding: 1, volumetricDivisor: 6000, bands: [], surcharges: [], containerType: '', notes: '' };
    case 'fx': return { ...base, ...validity, currency: 'USD', toCny: 7 };
  }
}
export function ResourceEditor({ kind, initial, catalog, save, busy }: { kind: Kind; initial: any; catalog: Catalog; save: (v: any) => void; busy: boolean }) {
  const [draft, setDraft] = useState<any>(structuredClone(initial));
  const set = (key: string, value: any) => setDraft((d: any) => ({ ...d, [key]: value }));
  const text = (key: string, label: string, required = false, type = 'text') => <Field key={key} label={label}><input type={type} required={required} value={draft[key] ?? ''} onChange={e => set(key,e.target.value)} maxLength={type === 'date' ? undefined : 200}/></Field>;
  const number = (key: string, label: string, required = false, min = 0) => <Field key={key} label={label}><input type="number" step="any" min={min} required={required} value={draft[key] ?? ''} onChange={e => set(key,e.target.value === '' ? undefined : Number(e.target.value))}/></Field>;
  const select = (key: string, label: string, options: { value: string; label: string }[]) => <Field key={key} label={label}><select value={draft[key]} onChange={e => set(key,e.target.value)} required><option value="" disabled>请选择</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>;
  return <form onSubmit={e => { e.preventDefault(); save(draft); }} className="editor-form">
    <div className="form-grid">
      {kind !== 'fx' && text('name','名称',true)}
      {kind === 'suppliers' && <>{text('contact','联系人 / 联系方式')}</>}
      {kind === 'nodes' && <>{text('city','城市',true)}{text('country','国家',true)}{select('type','节点类型', Object.entries({ city: '城市覆盖点', warehouse: '仓库', airport: '机场货站', port: '港口', rail: '铁路站', border: '口岸' }).map(([value,label]) => ({value,label})))}{text('timeZone','当地时区（如 Europe/London）',true)}</>}
      {kind === 'lanes' && <>
        {select('supplierId','供应商',catalog.suppliers.map(s => ({value:s.id,label:s.name})))}
        {select('from','起运节点',catalog.nodes.map(n => ({value:n.id,label:`${n.city} · ${n.name}`})))}
        {select('to','到达节点',catalog.nodes.map(n => ({value:n.id,label:`${n.city} · ${n.name}`})))}
        {select('mode','运输方式',modes.map(value => ({value,label:modeNames[value]})))}
        {number('transitHours','运输耗时（小时）',true,0.01)}{number('handlingHours','起运处理 / 中转准备（小时）',true)}
      </>}
      {kind === 'rates' && <>
        {select('laneId','适用线路',catalog.lanes.map(l => ({value:l.id,label:l.name})))}
        {text('currency','币种（CNY / USD / EUR / GBP 等）',true)}
        {select('unit','计价单位',units.map(value => ({value,label:unitNames[value]})))}
        {number('price','基础单价',true)}{number('minimum','最低基础运费',true)}{number('rounding','计费数量进位单位',true,0.0001)}
        {draft.unit === 'chargeableKg' && number('volumetricDivisor','体积重除数（cm³/kg）',true,1)}
        {draft.unit === 'container' && text('containerType','适用箱型（空白表示不限）')}
      </>}
      {kind === 'fx' && <>{text('currency','币种',true)}{number('toCny','1 单位外币折合人民币',true,0.000001)}</>}
      {['lanes','rates','fx'].includes(kind) && <>{text('validFrom','生效日期',true,'date')}{text('validTo','失效日期',true,'date')}</>}
    </div>
    {kind === 'lanes' && <>
      <h3>班期与截货</h3><label className="check"><input type="checkbox" checked={draft.onDemand} onChange={e => set('onDemand',e.target.checked)}/>按需发运（无固定班期）</label>
      {!draft.onDemand && <div className="subpanel"><label className="check"><input type="checkbox" checked={!!draft.schedule} onChange={e => set('schedule',e.target.checked ? { weekdays: [1,3,5], departureTime: '18:00', timeZone: 'Asia/Shanghai', cutoffHours: 8 } : undefined)}/>已掌握固定班期</label>{draft.schedule ? <>
        <div className="weekday-row">{['日','一','二','三','四','五','六'].map((d,i) => <label key={d} className="check"><input type="checkbox" checked={draft.schedule.weekdays.includes(i)} onChange={e => set('schedule',{ ...draft.schedule, weekdays: e.target.checked ? [...draft.schedule.weekdays,i] : draft.schedule.weekdays.filter((v: number) => v !== i) })}/>{d}</label>)}</div>
        <div className="form-grid"><Field label="发运当地时间"><input type="time" required value={draft.schedule.departureTime} onChange={e => set('schedule',{ ...draft.schedule, departureTime:e.target.value })}/></Field><Field label="班期时区"><input required value={draft.schedule.timeZone} onChange={e => set('schedule',{ ...draft.schedule, timeZone:e.target.value })}/></Field><Field label="提前截货（小时）"><input type="number" min="0" step="any" required value={draft.schedule.cutoffHours} onChange={e => set('schedule',{ ...draft.schedule, cutoffHours:Number(e.target.value) })}/></Field></div>
      </> : <p className="muted">班期待确认，该线路的出发时间仅用于估算。</p>}</div>}
      <h3>承运条件</h3><div className="form-grid">{cargoFlags.map(flag => <Field key={flag} label={flagNames[flag]}><select value={draft.capabilities[flag]} onChange={e => set('capabilities',{ ...draft.capabilities,[flag]:e.target.value })}><option value="unknown">未知 / 待确认</option><option value="yes">可承运</option><option value="no">不可承运</option></select></Field>)}</div>
      <h3>尺寸与载荷限制</h3><p className="muted">留空表示未知；按货物填写方向校验长、宽、高，不自动旋转货物。</p><div className="form-grid">{number('maxLengthCm','单件最大长度 cm')}{number('maxWidthCm','单件最大宽度 cm')}{number('maxHeightCm','单件最大高度 cm')}{number('maxPieceKg','单件最大重量 kg')}{number('maxShipmentKg','整票最大重量 kg')}{number('maxShipmentCbm','整票最大体积 m³')}</div>
      <div className="form-grid">{(['hazardousClasses','unNumbers','containerTypes'] as const).map((key,i) => <Field key={key} label={['允许危险品类别（逗号分隔）','允许 UN 编号（逗号分隔）','适用箱型（逗号分隔）'][i]}><input value={draft[key].join(',')} onChange={e => set(key,e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean))}/></Field>)}</div>
      <h3>配套服务</h3><div className="form-grid">{serviceNames.map(name => <Field key={name} label={name}><select value={draft.services.find((s: any) => s.name === name)?.status ?? 'unknown'} onChange={e => set('services',[...draft.services.filter((s: any) => s.name !== name),{name,status:e.target.value}])}><option value="unknown">待确认</option><option value="included">已包含（费用已计入运价）</option><option value="excluded">未包含，另行确认</option></select></Field>)}</div>
    </>}
    {kind === 'rates' && <>
      <h3>阶梯单价</h3><p className="muted">按进位后的计费数量选择首个覆盖上限的阶梯；超过全部阶梯时用基础单价。</p>
      {draft.bands.map((b: any,i: number) => <div className="inline-fields" key={i}><Field label="数量上限"><input required type="number" min="0.0001" step="any" value={b.upTo} onChange={e => set('bands',draft.bands.map((v: any,j: number) => j === i ? {...v,upTo:Number(e.target.value)} : v))}/></Field><Field label="该档单价"><input required type="number" min="0" step="any" value={b.price} onChange={e => set('bands',draft.bands.map((v: any,j: number) => j === i ? {...v,price:Number(e.target.value)} : v))}/></Field><button type="button" className="icon-button" aria-label="删除阶梯" onClick={() => set('bands',draft.bands.filter((_: any,j: number) => i !== j))}><Trash2 size={16}/></button></div>)}
      <button type="button" className="button secondary small" onClick={() => set('bands',[...draft.bands,{upTo:100,price:0}])}><Plus size={14}/>添加阶梯</button>
      <h3>附加费</h3><p className="muted">固定费用按票收取；百分比以最低收费处理后的基础运费为基数，各项不复利叠加。</p>
      {draft.surcharges.map((b: any,i: number) => <div className="inline-fields" key={i}><Field label="费用名称"><input required value={b.name} onChange={e => set('surcharges',draft.surcharges.map((v: any,j: number) => j === i ? {...v,name:e.target.value} : v))}/></Field><Field label="方式"><select value={b.kind} onChange={e => set('surcharges',draft.surcharges.map((v: any,j: number) => j === i ? {...v,kind:e.target.value} : v))}><option value="fixed">固定金额</option><option value="percent">基础运费百分比</option></select></Field><Field label="金额 / 百分数"><input required type="number" min="0" step="any" value={b.amount} onChange={e => set('surcharges',draft.surcharges.map((v: any,j: number) => j === i ? {...v,amount:Number(e.target.value)} : v))}/></Field><button type="button" className="icon-button" aria-label="删除附加费" onClick={() => set('surcharges',draft.surcharges.filter((_: any,j: number) => i !== j))}><Trash2 size={16}/></button></div>)}
      <button type="button" className="button secondary small" onClick={() => set('surcharges',[...draft.surcharges,{name:'',kind:'fixed',amount:0}])}><Plus size={14}/>添加附加费</button>
    </>}
    {kind !== 'nodes' && kind !== 'fx' && <Field label="适用范围 / 备注" wide><textarea value={draft.notes} rows={3} maxLength={2000} onChange={e => set('notes',e.target.value)}/></Field>}
    <footer className="modal-footer"><button className="button primary" disabled={busy}><Busy busy={busy}>保存{kindNames[kind]}</Busy></button></footer>
  </form>;
}
