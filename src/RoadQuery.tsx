import { useEffect, useRef, useState } from 'react';
import { Truck as TruckIcon, ArrowRight, Info, Settings2 } from 'lucide-react';
import { truckTemplates, type RoadRequest, type RoadResult, type RoadStatus } from '../shared/road';
import { countryName } from '../shared/geography';
import { CountrySelect, CitySelect } from './LocationFields';
import { Busy, Field, fmt } from './components';
import { api } from './api';

type FormState=Omit<RoadRequest,'originCityId'|'destinationCityId'>&{originCityId?:string;destinationCityId?:string;originCity:string;destinationCity:string};
const initial:FormState={originCountry:'CN',destinationCountry:'CN',originCity:'',destinationCity:'',vehicle:{...truckTemplates[0].vehicle},singleDailyHours:8,dualDailyHours:16,averageSpeedKph:60,loadingHours:null,waitingHours:null,borderHours:null,allowFerries:false,cargoType:'general'};
const modeNames={road:'公路',ferry:'轮渡',railFerry:'车辆摆渡列车',waiting:'接口等待'};
const dateTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
export function RoadQuery(){
  const [form,setForm]=useState<FormState>(initial),[status,setStatus]=useState<RoadStatus>(),[result,setResult]=useState<RoadResult>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const revision=useRef(0),requestNumber=useRef(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;void api<RoadStatus>('/road/status').then(s=>{if(alive.current)setStatus(s);}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;};},[]);
  const change=(patch:Partial<FormState>)=>{revision.current++;setForm(f=>({...f,...patch}));setResult(undefined);setError('');};
  const submit=async()=>{
    const currentRevision=revision.current,number=++requestNumber.current;
    setBusy(true);setError('');setResult(undefined);
    try{const data=await api<RoadResult>('/road/query','POST',form);if(alive.current&&revision.current===currentRevision)setResult(data);}
    catch(e){if(alive.current&&revision.current===currentRevision)setError((e as Error).message);}
    finally{if(alive.current&&requestNumber.current===number)setBusy(false);}
  };
  return <><div className="page-intro"><div><div className="eyebrow">ROAD DISTANCE & TRANSIT TIME</div><h1>陆运距离与时效</h1><p>查询城市间普通驾车路线与公路里程，估算卡车单驾与双驾时效。</p></div><div className="intro-mark"><TruckIcon size={30}/><span>中国国内 · 美国 · 欧洲</span></div></div><section className="panel road-panel" aria-label="陆运距离与时效查询"><header className="road-summary"><span><TruckIcon size={20}/><strong>城市路线查询</strong><span className="badge teal">国内优先 · 美国 / 欧洲</span></span></header>
    <div className="road-body"><p className="input-hint">选择两个城市，查询普通驾车路线的公路里程，同时估算卡车单驾与双驾时效。无需先录入供应商线路；已有匹配记录时优先从数据库读取。</p>
      <div className="road-providers">{status?.providers.map(p=><span key={p.id}><span className={`status-dot ${p.configured ? '' : 'pending'}`}/>{p.name}：{p.configured ? '已配置 · 权限待实测' : '待配置'}<a href={p.setupUrl} target="_blank" rel="noopener noreferrer">开通说明 ↗</a></span>)}</div>
      <form aria-label="陆运查询" onSubmit={e=>{e.preventDefault();void submit();}}>
        <div className="road-location-grid"><CountrySelect label="陆运起运国家" value={form.originCountry} onChange={originCountry=>change({originCountry,originCity:'',originCityId:undefined})}/><CitySelect label="陆运起运城市" country={form.originCountry} value={form.originCity} cityId={form.originCityId} onChange={(originCity,originCityId)=>change({originCity,originCityId})}/><CountrySelect label="陆运目的国家" value={form.destinationCountry} onChange={destinationCountry=>change({destinationCountry,destinationCity:'',destinationCityId:undefined})}/><CitySelect label="陆运目的城市" country={form.destinationCountry} value={form.destinationCity} cityId={form.destinationCityId} onChange={(destinationCity,destinationCityId)=>change({destinationCity,destinationCityId})}/></div>
        <div className="road-options"><span className="badge neutral">普通驾车参考路线</span><label className="check"><input type="checkbox" checked={form.allowFerries} onChange={e=>change({allowFerries:e.target.checked})}/>允许轮渡 / 车辆摆渡列车</label></div>
        <p className="input-hint">按普通驾车路径查询大概里程，不校验货车限高、限重、限行或特殊货物通行条件。</p>
        <details className="road-advanced"><summary><Settings2 size={15}/>时效测算参数 <span className="muted">参考车速 {form.averageSpeedKph} km/h · 单驾 {form.singleDailyHours} / 双驾 {form.dualDailyHours} 小时每天</span></summary>
          <div className="road-vehicle-grid"><Field label="卡车参考平均车速 km/h"><input aria-label="卡车参考平均车速 km/h" type="number" required min={10} max={100} step="any" value={form.averageSpeedKph} onChange={e=>change({averageSpeedKph:Number(e.target.value)})}/></Field><Field label="单驾每天累计驾驶 h"><input aria-label="单驾每天累计驾驶 h" type="number" required min={1} max={12} step="any" value={form.singleDailyHours} onChange={e=>change({singleDailyHours:Number(e.target.value)})}/></Field><Field label="双驾每天累计驾驶 h"><input aria-label="双驾每天累计驾驶 h" type="number" required min={1} max={24} step="any" value={form.dualDailyHours} onChange={e=>change({dualDailyHours:Number(e.target.value)})}/></Field>{([['loadingHours','装卸耗时 h'],['waitingHours','等待耗时 h'],['borderHours','通关及边境耗时 h']] as const).map(([key,label])=><Field key={key} label={label}><input aria-label={label} type="number" min={0} max={720} step="any" placeholder="未计入" value={form[key] ?? ''} onChange={e=>change({[key]:e.target.value==='' ? null : Number(e.target.value)})}/></Field>)}<Field label="计划出发时间（可选）"><input aria-label="陆运计划出发时间" type="datetime-local" onChange={e=>change({departureAt:e.target.value ? new Date(e.target.value).toISOString() : undefined})}/></Field></div>
          <p className="input-hint">卡车驾驶耗时按里程 ÷ 参考平均车速估算，并取不低于地图驾车耗时的值，默认 60 km/h，可修改。从开始行驶起，每 24 小时按设定累计驾驶窗口测算，其余时间休息；默认单驾 8 h、双驾 16 h，属于业务假设，不代表当地法规。额外耗时累加且不抵扣休息。出发时间按设备时区输入，仅推算预计到达，不预测未来路况。</p>
        </details>
        <div className="road-actions"><span className="input-hint">城市参考点之间测算 · 跨境通关另计 · 不保证送达</span><button className="button primary" disabled={busy||!form.originCityId||!form.destinationCityId}><Busy busy={busy}><TruckIcon size={16}/>查询陆运距离</Busy></button></div>
      </form>
      {error && <div role="alert" className="notice warning road-error"><Info size={16}/><span>{error}</span></div>}
      {result && <section className="road-result" aria-label="陆运查询结果" aria-live="polite"><div className="road-result-heading"><h3>{countryName(result.origin.country)} · {result.origin.name} <ArrowRight size={15}/> {countryName(result.destination.country)} · {result.destination.name}</h3><span><a href={result.sourceUrl} target="_blank" rel="noopener noreferrer">{result.providerName} ↗</a> · {dateTime(result.queriedAt)}（北京时间）{result.resultSource==='database' ? ' · 数据库记录（本次未调用 API）' : ' · API 查询（已保存数据库）'}</span></div>
        <div className="road-metrics"><div><small>公路里程</small><strong>{fmt(result.roadKm)} <span>km</span></strong><p>全程 {fmt(result.totalKm)} km</p></div><div><small>卡车参考驾驶耗时</small><strong>{fmt(result.drivingHours)} <span>h</span></strong><p>按参考车速估算 · 不含休息与等待</p></div><div><small>单驾预计运输时效</small><strong>{fmt(result.single.hours)} <span>h / {fmt(result.single.days)} 天</span></strong><p>每天驾驶 {result.request.singleDailyHours} h · 休息 {fmt(result.single.restHours)} h</p>{result.single.arrivalAt && <p>预计到达 {dateTime(result.single.arrivalAt)}（北京时间）</p>}</div><div><small>双驾预计运输时效</small><strong>{fmt(result.dual.hours)} <span>h / {fmt(result.dual.days)} 天</span></strong><p>每天累计驾驶 {result.request.dualDailyHours} h · 休息 {fmt(result.dual.restHours)} h</p>{result.dual.arrivalAt && <p>预计到达 {dateTime(result.dual.arrivalAt)}（北京时间）</p>}</div></div>
        <p className="input-hint">地图驾车耗时 {fmt(result.mapDrivingHours)} h；接口全程耗时 {fmt(result.providerHours)} h（含摆渡 / 接口等待 {fmt(result.transferHours)} h）；手动额外耗时 {fmt(result.additionalHours)} h。</p>
        {result.roadNames && result.roadNames.length>0 && <p className="input-hint">参考途经道路：{result.roadNames.join(" → ")}</p>}
        <div className="road-breakdown">{result.segments.map((s,i)=><span key={i}>{modeNames[s.kind]} · {fmt(s.distanceMeters/1000)} km · {fmt(s.durationSeconds/3600)} h{s.kind!=='road' && ` · ${s.name}`}</span>)}</div>
        <ul className="road-warnings">{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
      </section>}
      <details className="road-setup"><summary>数据服务开通与配置指引</summary><ol><li>主要国内查询：在高德创建 Web 服务 Key，使用普通路径规划与坐标转换能力，无需开通货车路线版本。</li><li>美国与欧洲：在 HERE 创建项目，生成 API Key，并开通 Routing API v8 的普通驾车权限；以账户套餐和地区覆盖为准。</li><li>本机配置：在项目目录执行 <code>npm run road:configure</code>，按提示安全录入密钥，再重启应用。服务器部署时设置 <code>AMAP_WEB_SERVICE_KEY</code> / <code>HERE_ROUTING_KEY</code> 环境变量。</li><li>配置后首次查询会检查实际权限。密钥保存在本机配置中，请勿粘贴到聊天、代码或 GitHub。</li></ol><p className="input-hint">查询成功后自动保存数据库；相同起止城市、方向和摆渡设置再次查询时直接读取历史记录，不重复调用 API。记录长期保留，时效按本次驾驶与等待参数重新计算，历史路线不代表实时路况。当前只预设中国大陆境内、美国境内及欧洲区域，中国跨境需按口岸分段核实。</p></details>
    </div>
  </section></>;
}
