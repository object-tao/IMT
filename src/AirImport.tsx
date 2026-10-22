import { useState } from 'react';
import { Upload, Download } from 'lucide-react';
import type { Catalog } from '../shared/model';
import type { AirImportPreview } from '../shared/air-import';
import { api, downloadText } from './api';
import { Modal, Field, Busy } from './components';
import { writeCsv } from '../shared/csv';

export function AirImport({catalog,supplierId,close,refresh,run,busy,report}:{catalog:Catalog;supplierId?:string;close:()=>void;refresh:()=>Promise<void>;run:(fn:()=>Promise<void>)=>void;busy:boolean;report:(s:string)=>void}){
  const now=new Date();
  const [supplier,setSupplier]=useState(supplierId??catalog.suppliers[0]?.id??''),[year,setYear]=useState(now.getFullYear()),[month,setMonth]=useState(now.getMonth()+1),[timeZone,setTimeZone]=useState('Asia/Shanghai');
  const [file,setFile]=useState<File>(),[preview,setPreview]=useState<AirImportPreview>(),[error,setError]=useState('');
  const reset=()=>{setPreview(undefined);setError('');};
  const invalid=preview&&(preview.errors.length>0||preview.rows.some(r=>r.action==='error'));
  return <Modal title="导入航空航线与飞行时刻" large close={close}>
    <div className="modal-body"><p>先维护机场资料。系统按机场三字代码、名称或别名匹配，按所选供应商复用航线；新时刻与航线一起写入。支持 XLSX 合并单元格及 CSV，截图需先整理成表格。</p>
      <div className="form-grid"><Field label="导入所属供应商"><select disabled={busy} value={supplier} onChange={e=>{setSupplier(e.target.value);reset();}}><option value="">请选择</option>{catalog.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="资料年份"><input disabled={busy} type="number" min={2000} max={2100} value={year} onChange={e=>{setYear(Number(e.target.value));reset();}}/></Field><Field label="默认月份"><input disabled={busy} type="number" min={1} max={12} value={month} onChange={e=>{setMonth(Number(e.target.value));reset();}}/></Field><Field label="表内全部时间采用时区"><input disabled={busy} value={timeZone} onChange={e=>{setTimeZone(e.target.value);reset();}}/></Field></div>
      <p className="input-hint">Asia/Shanghai 表示北京时间。机场当地时区独立保存；跨日需明确填写 1、2 等天数。班期 1–6 为周一至周六，7 为周日。</p>
      <button className="button secondary small" onClick={()=>downloadText('IMT-flight-import-template.csv',writeCsv([{起飞机场:'CTU',目的机场:'PRG',航班号:'XX1234',撤轮时间:'02:00',起飞时间:'02:20',落地时间:'12:00',挡轮时间:'12:15',班期:'1,3,5',执行日期:`${month}月1-25日`,执飞机型:'',机号:'',起飞跨日:0,落地跨日:0,到达跨日:0}]))}><Download size={15}/>下载航线时刻模板</button>
      <label className="upload-box"><Upload size={22}/><span>{file?.name??'选择 XLSX 或 CSV 文件（最多 5 MB）'}</span><input disabled={busy} aria-label="航空时刻文件" type="file" accept=".xlsx,.csv" onChange={e=>{setFile(e.target.files?.[0]);reset();}}/></label>
      <button disabled={busy||!file||!supplier} className="button secondary" onClick={()=>run(async()=>{setError('');setPreview(undefined);try{if(file!.size>5*1024*1024)throw new Error('文件不能超过 5 MB');const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file!);});setPreview(await api<AirImportPreview>('/air-import/preview','POST',{supplierId:supplier,year,month,timeZone,source:file!.name,file:{name:file!.name,base64}}));}catch(e){setError((e as Error).message);}})}><Busy busy={busy}>解析并预览</Busy></button>
      {error&&<div role="alert" className="notice error">{error}</div>}
      {preview&&<><div className={`notice ${invalid?'warning':''}`}><strong>新增航线 {preview.newLanes} 条 · 新增时刻 {preview.newFlights} 条 · 已有相同时刻 {preview.existing} 条</strong><p>来源：{preview.source} · {year} 年 · {timeZone}。重复数据跳过；时间冲突需编辑原记录，不会覆盖历史。</p>{preview.errors.map((e,i)=><p key={i}>{e}</p>)}</div><div className="table-scroll"><table className="resource-table"><thead><tr><th>原始行</th><th>航线 / 航班</th><th>执行日期</th><th>撤轮 / 起飞 / 落地 / 挡轮</th><th>结果</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.row}><td>{r.row}</td><td>{r.route}<br/>{r.flight}</td><td>{r.period}<br/>{r.details}</td><td>{r.times}</td><td>{r.action==='error'?r.errors.join('；'):r.action==='existing'?'已存在，跳过':'新增'}</td></tr>)}</tbody></table></div></>}
    </div><footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={close}>关闭</button><button className="button primary" disabled={busy||!preview||!!invalid||!preview.newFlights} onClick={()=>run(async()=>{await api('/catalog/import','POST',preview!.catalog);await refresh();report(`已导入 ${preview!.newLanes} 条航线、${preview!.newFlights} 条飞行时刻`);close();})}><Busy busy={busy}>确认导入数据库</Busy></button></footer>
  </Modal>;
}
