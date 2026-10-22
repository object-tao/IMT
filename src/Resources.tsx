import { useState } from 'react';
import { Search, Plus, Download, Upload, Pencil, Trash2, Database } from 'lucide-react';
import { kinds, schemas, emptyCatalog, modeNames, unitNames, type Kind, type Catalog } from '../shared/model';
import { demoCatalog } from '../shared/demo';
import { csvEntities, writeCsv } from '../shared/csv';
import { api, downloadText } from './api';
import { Modal, Busy } from './components';
import { ResourceEditor, blankResource, kindNames } from './ResourceEditor';
export function Resources({ catalog, refresh, run, busy, report }: { catalog: Catalog; refresh: () => Promise<void>; run: (fn: () => Promise<void>) => void; busy: boolean; report: (v: string) => void }) {
  const [kind,setKind] = useState<Kind>('suppliers'), [search,setSearch] = useState(''), [editing,setEditing] = useState<any>(), [isNew,setIsNew] = useState(false), [remove,setRemove] = useState<any>(), [importing,setImporting] = useState(false), [preview,setPreview] = useState<Catalog | null>(null), [fileError,setFileError] = useState('');
  const list = (catalog[kind] as any[]).filter(item => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()));
  const columns: Record<Kind,string[]> = { suppliers: ['供应商名称','联系信息','备注'], nodes: ['节点名称','城市 / 国家','类型 / 时区'], lanes: ['线路名称','运输节点','方式 / 耗时'], rates: ['运价名称','适用线路','单价 / 有效期'], fx: ['币种','折合人民币','有效期'] };
  function cells(item: any) {
    switch (kind) {
      case 'suppliers': return [item.name,item.contact || '—',item.notes || '—'];
      case 'nodes': return [item.name,`${item.city} / ${item.country}`,`${({ city:'城市覆盖点',warehouse:'仓库',airport:'机场',port:'港口',rail:'铁路站',border:'口岸' } as any)[item.type]} · ${item.timeZone}`];
      case 'lanes': return [item.name,`${catalog.nodes.find(n => n.id === item.from)?.name} → ${catalog.nodes.find(n => n.id === item.to)?.name}`,`${modeNames[item.mode]} · ${item.transitHours} 小时`];
      case 'rates': return [item.name,catalog.lanes.find(l => l.id === item.laneId)?.name,`${item.price} ${item.currency} / ${unitNames[item.unit]} · 至 ${item.validTo}`];
      case 'fx': return [item.currency,`1 ${item.currency} = ${item.toCny} CNY`,`${item.validFrom} 至 ${item.validTo}`];
    }
  }
  const loadFile = async (file?: File) => {
    setPreview(null); setFileError(''); if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件不得超过 5 MB');
      const content = await file.text();
      const incoming = file.name.toLowerCase().endsWith('.json') ? JSON.parse(content) : { [kind]: csvEntities(content) };
      if (!incoming || typeof incoming !== 'object' || Object.keys(incoming).some(k => !(kinds as readonly string[]).includes(k))) throw new Error('文件格式不正确，请使用模板或导出的资源文件');
      const parsed = emptyCatalog();
      for (const k of kinds) { if (incoming[k] && !Array.isArray(incoming[k])) throw new Error(`${kindNames[k]}格式不正确`); parsed[k] = (incoming[k] ?? []).map((r: unknown,i: number) => { const result = schemas[k].safeParse(r); if (!result.success) throw new Error(`${kindNames[k]}第 ${i + 1} 条：${result.error.issues.map(e => `${e.path.join('.')} ${e.message}`).join('；')}`); return result.data; }) as any; }
      if (!kinds.some(k => parsed[k].length)) throw new Error('文件没有可导入的数据');
      setPreview(parsed);
    } catch(e) { setFileError((e as Error).message); }
  };
  return <>
    <div className="page-intro"><div><div className="eyebrow">RESOURCE NETWORK</div><h1>把资源，连接成网络。</h1><p>维护可靠的供应商、节点、线路与运价，方案才有依据。</p></div><button className="button secondary" onClick={() => downloadText('IMT-resources.json',JSON.stringify(catalog,null,2),'application/json')}><Download size={16}/>导出资源备份</button></div>
    <section className="panel resources-panel"><div className="tabs">{kinds.map(k => <button key={k} className={kind === k ? 'active' : ''} onClick={() => { setKind(k); setSearch(''); }}>{kindNames[k]}<span>{catalog[k].length}</span></button>)}</div>
      <div className="table-toolbar"><div className="search-box"><Search size={17}/><input aria-label="搜索资源" placeholder={`搜索${kindNames[kind]}…`} value={search} onChange={e => setSearch(e.target.value)}/></div><div className="toolbar-actions"><button className="button secondary small" onClick={() => downloadText(`IMT-${kind}-template.csv`,writeCsv((demoCatalog()[kind] as any[]).slice(0,1)))}><Download size={15}/>CSV 模板</button><button className="button secondary small" onClick={() => { setImporting(true); setPreview(null); setFileError(''); }}><Upload size={15}/>导入</button><button className="button primary small" onClick={() => { setEditing(blankResource(kind,catalog)); setIsNew(true); }}><Plus size={15}/>新增{kindNames[kind]}</button></div></div>
      <div className="table-scroll"><table className="resource-table"><thead><tr>{columns[kind].map(c => <th key={c}>{c}</th>)}<th>操作</th></tr></thead><tbody>{list.map(item => <tr key={item.id}>{cells(item).map((v,i) => <td key={i}>{v}</td>)}<td><div className="row-actions"><button className="icon-button" aria-label={`编辑 ${item.name ?? item.currency}`} onClick={() => { setEditing(item); setIsNew(false); }}><Pencil size={15}/></button><button className="icon-button danger" aria-label={`删除 ${item.name ?? item.currency}`} onClick={() => setRemove(item)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>
      {!list.length && <div className="empty-small"><Database size={30}/><h3>{search ? '没有匹配的资源' : `尚未维护${kindNames[kind]}`}</h3><p>新增资料，或通过模板批量导入。</p></div>}
      <div className="table-footer">共 {list.length} 条 · 导入仅新增资料，已有关联资源需通过编辑修改</div>
    </section>
    {editing && <Modal title={`${isNew ? '新增' : '编辑'}${kindNames[kind]}`} large close={() => setEditing(undefined)}><ResourceEditor key={editing.id} kind={kind} catalog={catalog} initial={editing} busy={busy} save={value => run(async () => { await api(`/resources/${kind}${isNew ? '' : '/' + encodeURIComponent(value.id)}`,isNew ? 'POST' : 'PUT',value); await refresh(); setEditing(undefined); report('资源已保存'); })}/></Modal>}
    {remove && <Modal title="确认删除资源" close={() => setRemove(undefined)}><div className="modal-body"><p>删除“{remove.name ?? remove.currency}”？已有线路或运价引用的资源不能删除；历史方案快照保留。</p></div><footer className="modal-footer"><button className="button secondary" onClick={() => setRemove(undefined)}>取消</button><button disabled={busy} className="button danger-button" onClick={() => run(async () => { await api(`/resources/${kind}/${encodeURIComponent(remove.id)}?version=${remove.version}`,'DELETE'); await refresh(); setRemove(undefined); report('资源已删除'); })}>确认删除</button></footer></Modal>}
    {importing && <Modal title={`导入资源 · ${kindNames[kind]}`} close={() => setImporting(false)}><div className="modal-body"><p>CSV 文件导入当前分类；资源备份 JSON 可同时导入多个分类。请先导入供应商与节点，再导入线路和运价。</p><label className="upload-box"><Upload size={24}/><span>选择 CSV 或 JSON 文件</span><input aria-label="导入文件" type="file" accept=".csv,.json" onChange={e => void loadFile(e.target.files?.[0])}/></label>{fileError && <div role="alert" className="notice error">{fileError}</div>}{preview && <div className="notice"><strong>预览通过，待确认导入</strong><p>{kinds.map(k => `${kindNames[k]} ${preview[k].length} 条`).join(' · ')}</p><p>全部资料将一次性校验并写入，任一关联错误则整批不导入。</p></div>}</div><footer className="modal-footer"><button disabled={!preview || busy} className="button primary" onClick={() => run(async () => { await api('/catalog/import','POST',preview); await refresh(); setImporting(false); report('资源已导入'); })}><Busy busy={busy}>确认导入</Busy></button></footer></Modal>}
  </>;
}
