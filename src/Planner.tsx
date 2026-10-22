import { useState } from 'react';
import { Plus, Trash2, ArrowRight, Package, Sparkles, Clock3, Route, Plane, Truck, Ship, TrainFront, CircleCheck, CircleAlert } from 'lucide-react';
import { cargoFlags, flagNames, modeNames, type Catalog, type Demand, type Candidate, type SolveResult } from '../shared/model';
import { totals } from '../shared/pricing';
import { demoDemand } from '../shared/demo';
import { api } from './api';
import { Field, Busy, fmt, dateTime, inputDate } from './components';
export function freshDemand(): Demand { const example = demoDemand(); return { ...example, originCity: '', destinationCity: '', deadline: undefined, cargo: [{ ...example.cargo[0], name: '', pieces: 1, weightKg: 100 }], notes: '' }; }
export function ModeIcon({ mode, size = 16 }: { mode: string; size?: number }) { const Icon = mode === 'air' ? Plane : mode === 'sea' ? Ship : mode === 'rail' ? TrainFront : Truck; return <Icon size={size}/>; }
export function Planner({ catalog, demand, setDemand, openCandidate, report, busy, run }: { catalog: Catalog; demand: Demand; setDemand: (d: Demand) => void; openCandidate: (c: Candidate,r: Demand) => void; report: (s: string) => void; busy: boolean; run: (fn: () => Promise<void>) => void }) {
  const [result,setResult] = useState<SolveResult | null>(null), [computed,setComputed] = useState<Demand | null>(null);
  const [filter,setFilter] = useState('all');
  const update = (key: keyof Demand, value: any) => setDemand({ ...demand,[key]:value });
  const cargo = totals(demand), cities = [...new Set(catalog.nodes.map(n => n.city))].sort();
  const items = result?.candidates.filter(c => filter === 'all' || (filter === 'complete' ? c.complete : !c.complete)) ?? [];
  return <>
    <div className="page-intro"><div><div className="eyebrow">MULTIMODAL PLANNING</div><h1>每一程，都有更好的连接。</h1><p>从运输需求出发，组合资源，找到适合的交付方案。</p></div><div className="intro-mark"><Route size={30}/><span>公路 · 铁路 · 航空 · 海运</span></div></div>
    <div className="planning-layout">
      <form className="panel demand-panel" onSubmit={e => { e.preventDefault(); run(async () => { const data = await api<SolveResult>('/solve','POST',demand); setComputed(structuredClone(demand)); setResult(data); setFilter('all'); report(`已生成 ${data.candidates.length} 个候选方案`); }); }}>
        <div className="panel-heading"><div><h2>运输需求</h2><p>输入城市、货物与交付要求</p></div><span className="step-label">01 / INPUT</span></div>
        <div className="route-input"><Field label="起运城市"><input aria-label="起运城市" placeholder="例如：上海" list="cities" required value={demand.originCity} onChange={e => update('originCity',e.target.value.trim())}/></Field><div className="route-input-line"><span/><ArrowRight size={14}/><span/></div><Field label="目的城市"><input aria-label="目的城市" placeholder="例如：伦敦" list="cities" required value={demand.destinationCity} onChange={e => update('destinationCity',e.target.value.trim())}/></Field><datalist id="cities">{cities.map(c => <option key={c} value={c}/>)}</datalist></div>
        <div className="form-grid"><Field label="最早可提货时间"><input aria-label="最早可提货时间" type="datetime-local" required value={inputDate(demand.readyAt)} onChange={e => { if(e.target.value) update('readyAt',new Date(e.target.value).toISOString()); }}/></Field><Field label="最晚要求送达（可选）"><input aria-label="最晚要求送达" type="datetime-local" value={demand.deadline ? inputDate(demand.deadline) : ''} onChange={e => update('deadline',e.target.value ? new Date(e.target.value).toISOString() : undefined)}/></Field></div>
        <p className="input-hint">输入时间采用设备当地时区，方案结果统一展示北京时间。</p>
        <div className="section-heading"><h3><Package size={16}/>货物明细</h3><span>{cargo.pieces} 件 · {fmt(cargo.kg.toNumber())} kg · {fmt(cargo.cbm.toNumber())} m³</span></div>
        {demand.cargo.map((item,index) => {
          const edit = (key: string,value: any) => update('cargo',demand.cargo.map((c,i) => i === index ? { ...c,[key]:value } : c));
          return <section className="cargo-card" key={index}><div className="cargo-title"><span>货物组 {String(index + 1).padStart(2,'0')}</span>{demand.cargo.length > 1 && <button className="icon-button" type="button" aria-label="删除货物组" onClick={() => update('cargo',demand.cargo.filter((_,i) => i !== index))}><Trash2 size={14}/></button>}</div>
            <div className="form-grid"><Field label="货物名称"><input required aria-label={`货物名称 ${index + 1}`} placeholder="设备 / 零件 / 货品名称" value={item.name} onChange={e => edit('name',e.target.value)}/></Field><Field label="包装"><input placeholder="木箱 / 托盘等" value={item.packaging} onChange={e => edit('packaging',e.target.value)}/></Field></div>
            <div className="cargo-numbers">{([['pieces','件数'],['weightKg','单件 kg'],['lengthCm','长 cm'],['widthCm','宽 cm'],['heightCm','高 cm']] as const).map(([key,label]) => <Field key={key} label={label}><input required aria-label={`${label} ${index + 1}`} type="number" min={key === 'pieces' ? 1 : 0.01} step={key === 'pieces' ? 1 : 'any'} value={item[key] || ''} onChange={e => edit(key,Number(e.target.value))}/></Field>)}</div>
            <div className="check-row"><label className="check"><input type="checkbox" checked={item.stackable} onChange={e => edit('stackable',e.target.checked)}/>可堆叠</label><label className="check"><input type="checkbox" checked={item.upright} onChange={e => edit('upright',e.target.checked)}/>保持直立</label></div>
            <details><summary>特殊货物属性 {item.flags.length > 0 && `· 已选 ${item.flags.length} 项`}</summary><div className="flag-grid">{cargoFlags.map(flag => <label className="check" key={flag}><input type="checkbox" checked={item.flags.includes(flag)} onChange={e => edit('flags',e.target.checked ? [...item.flags,flag] : item.flags.filter(f => f !== flag))}/>{flagNames[flag]}</label>)}</div>{item.flags.includes('hazardous') && <div className="form-grid"><Field label="危险品类别"><input value={item.hazardousClass} onChange={e => edit('hazardousClass',e.target.value)} placeholder="例如：9"/></Field><Field label="UN 编号"><input value={item.unNumber} onChange={e => edit('unNumber',e.target.value.toUpperCase())} placeholder="例如：UN3481" pattern="UN[0-9]{4}|"/></Field></div>}</details>
          </section>;
        })}
        <button className="button text-button" type="button" onClick={() => update('cargo',[...demand.cargo,{ ...freshDemand().cargo[0] }])}><Plus size={16}/>添加一组货物</button>
        <details className="extra-fields"><summary>整车 / 整柜数量及其他要求</summary><div className="form-grid"><Field label="车辆数（按车计价时填写）"><input min="1" step="1" type="number" value={demand.vehicleCount ?? ''} onChange={e => update('vehicleCount',e.target.value ? Number(e.target.value) : undefined)}/></Field><Field label="集装箱数量"><input min="1" step="1" type="number" value={demand.containerCount ?? ''} onChange={e => update('containerCount',e.target.value ? Number(e.target.value) : undefined)}/></Field><Field label="箱型"><input placeholder="例如：40HC" value={demand.containerType} onChange={e => update('containerType',e.target.value)}/></Field></div><Field label="其他要求"><textarea rows={2} value={demand.notes} onChange={e => update('notes',e.target.value)}/></Field></details>
        <button disabled={busy || !catalog.lanes.length} className="button primary solve-button"><Busy busy={busy}><Sparkles size={17}/>生成运输方案<ArrowRight size={17}/></Busy></button>
        <p className="input-hint center">根据已维护资源计算 · 不自动确认舱位及运力</p>
      </form>
      <section className="result-area"><div className="result-heading"><div><h2>候选方案 {result && <span className="count-pill">{result.candidates.length}</span>}</h2><p>{computed ? `${computed.originCity} → ${computed.destinationCity} · ${computed.cargo.length} 组货物` : '完整的路径，透明的取舍。'}</p></div>{result && <select aria-label="方案筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部方案</option><option value="complete">资料完整</option><option value="pending">待补全 / 待确认</option></select>}</div>
        {!result ? <div className="empty-planner"><NetworkIllustration/><div className="eyebrow">CONNECT THE POSSIBILITIES</div><h2>让分散的资源，成为完整的方案。</h2><p>填写左侧需求，系统会连接供应商线路，<br/>比较参考费用、时效和适运条件。</p><div className="empty-features"><span><CircleCheck size={16}/>承运条件校验</span><span><Clock3 size={16}/>班期衔接</span><span><Route size={16}/>多路径比较</span></div></div> : <>
          {result.diagnostics.length > 0 && <div className="notice warning">{result.diagnostics.map((d,i) => <p key={i}><CircleAlert size={15}/>{d}</p>)}</div>}
          {items.map((c,i) => <CandidateCard key={c.id} candidate={c} index={i} open={() => openCandidate(c,computed!)}/>)}
          {!items.length && <div className="empty-small"><Route size={30}/><h3>暂无匹配方案</h3><p>检查运输资源、货物限制及有效期，或调整筛选条件。</p></div>}
          {items.length > 0 && <p className="result-footnote">费用与时效基于当前维护资料。推荐仅在本次候选方案中比较；待确认方案不参与完整方案推荐。</p>}
        </>}
      </section>
    </div>
  </>;
}
function CandidateCard({ candidate: c,index,open }: { candidate: Candidate; index: number; open: () => void }) {
  const nodes = [c.legs[0].from,...c.legs.map(l => l.to)];
  const cities = nodes.filter((n,i) => !i || n.city !== nodes[i - 1].city).map(n => n.city);
  return <article className={`candidate-card ${c.badges.length ? 'recommended' : ''}`}>
    <div className="candidate-top"><span className="candidate-number">方案 {String(index + 1).padStart(2,'0')}</span><div className="badges">{c.badges.map(b => <span key={b} className="badge teal">{b}</span>)}<span className={`badge ${c.complete ? 'neutral' : 'amber'}`}>{c.complete ? '资料完整' : '待确认'}</span></div></div>
    <h3 className="city-path">{cities.map((city,i) => <span key={i}>{i > 0 && <ArrowRight size={15}/>} {city}</span>)}</h3>
    <div className="mode-route">{c.legs.map((l,i) => <span key={i} className={l.missing ? 'missing-leg' : ''}><ModeIcon mode={l.mode}/>{l.missing ? '缺失接驳' : modeNames[l.mode]}{i < c.legs.length - 1 && <span className="route-dash"/>}</span>)}</div>
    <div className="candidate-metrics"><div><small>{c.priceComplete ? '运输段参考费用' : '已知费用小计'}</small><strong><span>¥</span>{fmt(c.knownCny)}</strong>{!c.priceComplete && <em>部分费用待补充</em>}</div><div><small>{c.legs.some(l => l.missing) ? '已知耗时（不含缺失段）' : '预计总耗时'}</small><strong>{fmt(c.hours / 24)}<span> 天</span></strong><em>{dateTime(c.arrival)} 预计到达</em></div><div className="candidate-action"><button className="button secondary" onClick={open}>查看与调整<ArrowRight size={15}/></button></div></div>
    {c.lateHours > 0 && <div className="candidate-alert"><Clock3 size={14}/>按已知耗时预计晚到 {fmt(c.lateHours / 24)} 天</div>}
    {!c.complete && <div className="candidate-alert"><CircleAlert size={14}/>{c.warnings.length} 项资料待确认，请查看详情</div>}
  </article>;
}
function NetworkIllustration() {
  return <svg viewBox="0 0 540 240" className="network-illustration" aria-hidden="true"><defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d8e4e5"/></pattern></defs><rect width="540" height="240" fill="url(#dots)"/><path d="M70 170 L185 85 L330 120 L465 55 M185 85 L280 200 L465 55 M70 170 L280 200" fill="none" stroke="#b8cdcd" strokeWidth="2" strokeDasharray="5 6"/><path d="M70 170 Q170 10 330 120 Q400 140 465 55" fill="none" stroke="#237d76" strokeWidth="3"/>{[[70,170],[185,85],[330,120],[465,55],[280,200]].map(([x,y],i) => <g key={i}><circle cx={x} cy={y} r={i === 0 || i === 3 ? 12 : 8} fill="#edf5f2" stroke="#237d76" strokeWidth="2"/><circle cx={x} cy={y} r="3" fill="#237d76"/></g>)}<rect x="221" y="46" width="100" height="32" rx="16" fill="white" stroke="#d9e5e1"/><text x="271" y="67" textAnchor="middle" fontSize="12" fill="#237d76">多种可能，一路连接</text></svg>;
}
