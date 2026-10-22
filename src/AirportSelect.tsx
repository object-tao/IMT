import { useState } from 'react';
import type { Airport } from '../shared/model';
import { Field } from './components';
export function AirportSelect({label,airports,value,onChange}:{label:string;airports:Airport[];value:string;onChange:(id:string)=>void}){
  const [query,setQuery]=useState('');const filtered=airports.filter(a=>a.id===value||[a.iata,a.name,a.nameEn,a.city,...a.aliases].some(v=>v.toLowerCase().includes(query.toLowerCase())));
  return <Field label={label}><input aria-label={`${label}搜索`} placeholder="搜索中文、英文或三字代码" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label={label} required value={value} onChange={e=>onChange(e.target.value)}><option value="" disabled>请选择机场</option>{filtered.map(a=><option key={a.id} value={a.id}>{a.iata} · {a.name} · {a.nameEn}</option>)}</select></Field>;
}
