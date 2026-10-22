import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cargoFlags, flagNames, modeNames, unitNames, modes, units, type Catalog, type Kind } from '../shared/model';
import { Field, Busy } from './components';
import { CountrySelect, CitySelect } from './LocationFields';
import { countryCode } from '../shared/geography';
import { AirportSelect } from './AirportSelect';
export const kindNames: Record<Kind, string> = { suppliers: '供应商',airports:'机场', nodes: '运输节点', lanes: '分段线路',flights:'飞行时刻', rates: '运价', fx: '汇率' };
const serviceNames = ['出口报关','进口清关','装卸','仓储','保险'];
export function blankResource(kind: Kind, catalog: Catalog): any {
  const base = { id: crypto.randomUUID(), version: 1 };
  const validity = { validFrom: new Date().toISOString().slice(0,10), validTo: `${new Date().getFullYear() + 1}-12-31` };
  switch (kind) {
    case 'suppliers': return { ...base, name: '', contact: '', notes: '' };
    case 'nodes': return { ...base, name: '', city: '', country: 'CN', type: 'city', timeZone: 'Asia/Shanghai' };
    case 'airports':return {...base,name:'',nameEn:'',iata:'',country:'CN',city:'',cityId:undefined,timeZone:'Asia/Shanghai',aliases:[],notes:''};
    case 'flights':return {...base,...validity,laneId:catalog.lanes.find(l=>l.fromAirportId)?.id ?? '',flightNumber:'',kind:'weekly',weekdays:[1,3,5],timeZone:'Asia/Shanghai',offBlockTime:'',takeoffTime:'',landingTime:'',onBlockTime:'',takeoffDayOffset:0,landingDayOffset:0,arrivalDayOffset:0,aircraft:'',registration:'',cutoffHours:null,status:'planned',source:'',notes:''};
    case 'lanes': return { ...base, ...validity, name: '', supplierId: catalog.suppliers[0]?.id ?? '', from: catalog.nodes[0]?.id ?? '', to: catalog.nodes[1]?.id ?? '', mode: 'road', transitHours: 24, handlingHours: 0, onDemand: true, capabilities: Object.fromEntries(cargoFlags.map(f => [f,'unknown'])), hazardousClasses: [], unNumbers: [], containerTypes: [], services: serviceNames.map(name => ({ name, status: 'unknown' })), notes: '' };
    case 'rates': return { ...base, ...validity, name: '', laneId: catalog.lanes[0]?.id ?? '', currency: 'CNY', unit: 'kg', price: 0, minimum: 0, rounding: 1, volumetricDivisor: 6000, bands: [], surcharges: [], containerType: '', notes: '' };
    case 'fx': return { ...base, ...validity, currency: 'USD', toCny: 7 };
  }
}
export function ResourceEditor({ kind, initial, catalog, save, busy }: { kind: Kind; initial: any; catalog: Catalog; save: (v: any) => void; busy: boolean }) {
  const [draft, setDraft] = useState<any>(()=>({...structuredClone(initial),...(kind==='nodes' ? {country:countryCode(initial.country) ?? ''} : {})}));
  const [aliasesText,setAliasesText]=useState<string>((initial.aliases??[]).join(', '));
  const set = (key: string, value: any) => setDraft((d: any) => ({ ...d, [key]: value }));
  const text = (key: string, label: string, required = false, type = 'text') => <Field key={key} label={label}><input type={type} required={required} value={draft[key] ?? ''} onChange={e => set(key,e.target.value)} maxLength={type === 'date' ? undefined : 200}/></Field>;
  const number = (key: string, label: string, required = false, min = 0) => <Field key={key} label={label}><input type="number" step="any" min={min} required={required} value={draft[key] ?? ''} onChange={e => set(key,e.target.value === '' ? undefined : Number(e.target.value))}/></Field>;
  const select = (key: string, label: string, options: { value: string; label: string }[]) => <Field key={key} label={label}><select value={draft[key]} onChange={e => set(key,e.target.value)} required><option value="" disabled>请选择</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>;
  return <form onSubmit={e => { e.preventDefault(); save(kind==='airports'?{...draft,aliases:aliasesText.split(/[,，]/).map(v=>v.trim()).filter(Boolean)}:kind==='flights'?{...draft,takeoffTime:draft.takeoffTime||undefined,landingTime:draft.landingTime||undefined,operatingDate:draft.kind==='date'?draft.operatingDate:undefined}:draft); }} className="editor-form">
    <div className="form-grid">
      {kind !== 'fx' && kind!=='flights' && text('name',kind==='airports'?'中文名称':'名称',true)}
      {kind==='airports'&&<>{text('nameEn','英文名称',true)}<Field label="IATA 三字代码"><input aria-label="IATA 三字代码" required pattern="[A-Z]{3}" maxLength={3} value={draft.iata} onChange={e=>set('iata',e.target.value.toUpperCase())}/></Field><CountrySelect label="机场所在国家" value={draft.country} onChange={country=>setDraft({...draft,country,city:'',cityId:undefined,timeZone:''})}/><CitySelect label="机场所在城市" country={draft.country} value={draft.city} cityId={draft.cityId} onChange={(city,cityId,location)=>setDraft({...draft,city,cityId,...(location?.timeZone?{timeZone:location.timeZone}:{})})}/>{text('timeZone','机场当地时区',true)}<Field label="机场别名（逗号分隔）"><input value={aliasesText} onChange={e=>setAliasesText(e.target.value)}/></Field></>}
      {kind==='flights'&&<>{select('laneId','所属航线',catalog.lanes.filter(l=>l.mode==='air'&&l.fromAirportId).map(l=>({value:l.id,label:`${catalog.suppliers.find(s=>s.id===l.supplierId)?.name} · ${l.name}`})))}{text('flightNumber','航班号',true)}{select('kind','执行方式',[{value:'weekly',label:'周期班期'},{value:'date',label:'指定日期（优先于周期规则）'}])}{draft.kind==='date'&&text('operatingDate','执行日期',true,'date')}{text('timeZone','时刻表采用时区',true)}{text('offBlockTime','撤轮时间',true,'time')}{text('takeoffTime','起飞时间',false,'time')}{text('landingTime','落地时间',false,'time')}{text('onBlockTime','挡轮时间',true,'time')}{number('takeoffDayOffset','起飞跨日（天）',true)}{number('landingDayOffset','落地跨日（天）',true)}{number('arrivalDayOffset','挡轮跨日（天）',true)}{text('aircraft','执飞机型')}{text('registration','机号')}{number('cutoffHours','提前截货小时（留空待确认）')}{select('status','时刻状态',[{value:'planned',label:'计划 / 待确认'},{value:'confirmed',label:'已确认'},{value:'cancelled',label:'已取消'},{value:'archived',label:'历史归档'}])}{text('source','资料来源')}</>}
      {kind === 'suppliers' && <>{text('contact','联系人 / 联系方式')}</>}
      {kind === 'nodes' && <><CountrySelect label="国家" value={draft.country} onChange={country=>setDraft({...draft,country,city:'',cityId:undefined,timeZone:''})}/><CitySelect label="城市" country={draft.country} value={draft.city} cityId={draft.cityId} onChange={(city,cityId,location)=>setDraft({...draft,city,cityId,...(location?.timeZone ? {timeZone:location.timeZone} : {})})}/>{select('type','节点类型', Object.entries({ city: '城市覆盖点', warehouse: '仓库', airport: '机场货站', port: '港口', rail: '铁路站', border: '口岸' }).map(([value,label]) => ({value,label})))}{text('timeZone','当地时区（如 Europe/London）',true)}</>}
      {kind === 'lanes' && <>
        {select('supplierId','供应商',catalog.suppliers.map(s => ({value:s.id,label:s.name})))}
        <Field label="运输方式"><select value={draft.mode} onChange={e=>setDraft({...draft,mode:e.target.value,fromAirportId:undefined,toAirportId:undefined,from:'',to:'',...(e.target.value==='air'?{onDemand:false,schedule:undefined,transitHours:undefined,validityUnknown:true,validFrom:'0001-01-01',validTo:'9999-12-31'}:{validityUnknown:false,transitHours:24,validFrom:new Date().toISOString().slice(0,10),validTo:`${new Date().getFullYear()+1}-12-31`})})}>{modes.map(value=><option key={value} value={value}>{modeNames[value]}</option>)}</select></Field>
        {draft.mode==='air'?<><AirportSelect label="起飞机场" airports={catalog.airports} value={draft.fromAirportId ?? ''} onChange={id=>setDraft({...draft,fromAirportId:id,from:id,onDemand:false,schedule:undefined})}/><AirportSelect label="目的机场" airports={catalog.airports} value={draft.toAirportId ?? ''} onChange={id=>setDraft({...draft,toAirportId:id,to:id,onDemand:false,schedule:undefined})}/></>:<>{select('from','起运节点',catalog.nodes.map(n=>({value:n.id,label:`${n.city} · ${n.name}`})))}{select('to','到达节点',catalog.nodes.map(n=>({value:n.id,label:`${n.city} · ${n.name}`})))}</>}
        {number('transitHours','参考运输耗时（小时，航空可留空）',draft.mode!=='air',0.01)}{number('handlingHours','起运处理 / 中转准备（小时）',true)}
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
      {kind==='lanes'&&draft.mode==='air'&&<label className="check"><input type="checkbox" checked={!!draft.validityUnknown} onChange={e=>setDraft({...draft,validityUnknown:e.target.checked,validFrom:e.target.checked?'0001-01-01':new Date().toISOString().slice(0,10),validTo:e.target.checked?'9999-12-31':`${new Date().getFullYear()+1}-12-31`})}/>航线经营有效期待确认</label>}
      {['lanes','flights','rates','fx'].includes(kind) && !(kind==='lanes'&&draft.validityUnknown) && <>{text('validFrom','生效日期',true,'date')}{text('validTo','失效日期',true,'date')}</>}
    </div>
    {kind==='flights'&&<><p className="input-hint">四项时间均按所填时刻表时区解释，与机场当地时区分开。跨日填写 +1、+2 等，截货未知须留空。</p>{draft.kind==='weekly'&&<div className="weekday-row">{['日','一','二','三','四','五','六'].map((d,i)=><label className="check" key={d}><input type="checkbox" checked={draft.weekdays.includes(i)} onChange={e=>set('weekdays',e.target.checked?[...draft.weekdays,i]:draft.weekdays.filter((v:number)=>v!==i))}/>{d}</label>)}</div>}</>}
    {kind === 'lanes' && <>
      {draft.mode==='air'?<div className="notice">航线可先保存，飞行时刻在下级分类中单独维护。没有时刻时只展示方案框架，不视为随到随发。</div>:<>
      <h3>班期与截货</h3><label className="check"><input type="checkbox" checked={draft.onDemand} onChange={e => set('onDemand',e.target.checked)}/>按需发运（无固定班期）</label>
      {!draft.onDemand && <div className="subpanel"><label className="check"><input type="checkbox" checked={!!draft.schedule} onChange={e => set('schedule',e.target.checked ? { weekdays: [1,3,5], departureTime: '18:00', timeZone: 'Asia/Shanghai', cutoffHours: 8 } : undefined)}/>已掌握固定班期</label>{draft.schedule ? <>
        <div className="weekday-row">{['日','一','二','三','四','五','六'].map((d,i) => <label key={d} className="check"><input type="checkbox" checked={draft.schedule.weekdays.includes(i)} onChange={e => set('schedule',{ ...draft.schedule, weekdays: e.target.checked ? [...draft.schedule.weekdays,i] : draft.schedule.weekdays.filter((v: number) => v !== i) })}/>{d}</label>)}</div>
        <div className="form-grid"><Field label="发运当地时间"><input type="time" required value={draft.schedule.departureTime} onChange={e => set('schedule',{ ...draft.schedule, departureTime:e.target.value })}/></Field><Field label="班期时区"><input required value={draft.schedule.timeZone} onChange={e => set('schedule',{ ...draft.schedule, timeZone:e.target.value })}/></Field><Field label="提前截货（小时）"><input type="number" min="0" step="any" required value={draft.schedule.cutoffHours} onChange={e => set('schedule',{ ...draft.schedule, cutoffHours:Number(e.target.value) })}/></Field></div>
      </> : <p className="muted">班期待确认，该线路的出发时间仅用于估算。</p>}</div>}
      </>}
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
