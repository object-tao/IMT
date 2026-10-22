import { useEffect, useId, useRef, useState } from 'react';
import { Search, LoaderCircle, MapPin } from 'lucide-react';
import { countries, countryCode, type GeoCity } from '../shared/geography';
import { Field } from './components';

const sortedCountries=[...countries].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
export function CountrySelect({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <Field label={label}><select aria-label={label} required value={countryCode(value) ?? ''} onChange={e=>onChange(e.target.value)}><option value="" disabled>请选择国家 / 地区</option>{sortedCountries.map(c=><option key={c.code} value={c.code}>{c.name} · {c.nameEn} ({c.code})</option>)}</select></Field>;
}
type SearchResult={items:GeoCity[];hasMore:boolean;nextOffset:number|null};
export function CitySelect({label,country,value,cityId,onChange}:{label:string;country:string;value:string;cityId?:string;onChange:(name:string,id?:string,city?:GeoCity)=>void}) {
  const [open,setOpen]=useState(false),[result,setResult]=useState<SearchResult>({items:[],hasMore:false,nextOffset:null}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[active,setActive]=useState(0);
  const id=useId(),input=useRef<HTMLInputElement>(null),generation=useRef(0);
  useEffect(()=>{input.current?.setCustomValidity(country && value && !cityId ? '请从候选列表中选择城市，以区分同名地点' : '');},[country,value,cityId]);
  useEffect(()=>{
    const current=++generation.current;setResult({items:[],hasMore:false,nextOffset:null});setError('');setActive(0);
    if(!open || !country){setBusy(false);return;}
    const controller=new AbortController();setBusy(true);
    const timer=setTimeout(()=>{
      void fetch(`/api/geo/cities?${new URLSearchParams({country,q:value,limit:'40'})}`,{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.message || '城市查询失败');return data as SearchResult;}).then(data=>{if(current===generation.current)setResult(data);}).catch(e=>{if(!controller.signal.aborted && current===generation.current)setError(e.message);}).finally(()=>{if(current===generation.current)setBusy(false);});
    },180);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[country,value,open]);
  const choose=(city:GeoCity)=>{onChange(city.name,city.id,city);setOpen(false);setError('');};
  const more=async()=>{
    if(result.nextOffset===null || busy)return;
    const current=generation.current;setBusy(true);
    try{const r=await fetch(`/api/geo/cities?${new URLSearchParams({country,q:value,offset:String(result.nextOffset),limit:'40'})}`);const data=await r.json();if(!r.ok)throw new Error(data.message || '城市查询失败');if(current===generation.current)setResult(previous=>({...data,items:[...previous.items,...data.items]}));}
    catch(e){if(current===generation.current)setError((e as Error).message);}finally{if(current===generation.current)setBusy(false);}
  };
  return <div className="city-picker"><Field label={label}><div className="city-picker-input"><Search size={14}/><input ref={input} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={id} aria-activedescendant={open && result.items[active] ? `${id}-${active}` : undefined} autoComplete="off" required disabled={!country} placeholder={country ? '搜索中文、英文或当地名称' : '请先选择国家'} value={value} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),120)} onChange={e=>{onChange(e.target.value);setOpen(true);}} onKeyDown={e=>{
      if(e.key==='Escape')setOpen(false);
      if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(i=>Math.min(i+1,result.items.length-1));}
      if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}
      if(e.key==='Enter' && open && result.items[active]){e.preventDefault();choose(result.items[active]);}
    }}/>{busy && <LoaderCircle size={13} className="spin"/>}</div></Field>
    {open && country && <div className="city-picker-popup"><div role="listbox" id={id} aria-label={`${label}候选城市`} className="city-options">{result.items.map((city,i)=><button type="button" role="option" aria-selected={city.id===cityId} id={`${id}-${i}`} className={active===i ? 'highlighted' : ''} key={city.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(city)}><MapPin size={14}/><div><strong>{city.name}</strong><span>{city.nameEn}{city.admin1 ? ` · ${city.admin1}` : ''}</span></div></button>)}</div>{!busy && !result.items.length && !error && <p className="city-picker-message">没有匹配地点，请尝试英文名或其他别名。</p>}{error && <p role="alert" className="city-picker-message error">{error}</p>}{busy && <p className="city-picker-message">正在查询城市…</p>}{result.hasMore && <button type="button" className="city-load-more" disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={()=>void more()}>加载更多城市</button>}</div>}
  </div>;
}
