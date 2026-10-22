import { Children,cloneElement,isValidElement,type ReactNode } from 'react';
import { X, LoaderCircle } from 'lucide-react';
export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  const controls=Children.map(children,child=>isValidElement<{'aria-label'?:string}>(child)&&typeof child.type==='string'&&['input','select','textarea'].includes(child.type)?cloneElement(child,{'aria-label':child.props['aria-label']??label}):child);
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{controls}{hint && <small>{hint}</small>}</label>;
}
export function Modal({ title, children, close, large = false }: { title: string; children: ReactNode; close: () => void; large?: boolean }) {
  return <div className="modal-shade" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section role="dialog" aria-modal="true" aria-label={title} className={`modal ${large ? 'large' : ''}`}><header><h2>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="关闭"><X size={20}/></button></header>{children}</section></div>;
}
export function Busy({ busy, children }: { busy: boolean; children: ReactNode }) { return <>{busy && <LoaderCircle className="spin" size={16}/>} {children}</>; }
export const fmt = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
export const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const inputDate = (value: string) => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
