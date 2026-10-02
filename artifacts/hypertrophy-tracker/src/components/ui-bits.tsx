import type { ReactNode } from 'react';
import { CircleHelp, Dumbbell } from 'lucide-react';

export function Loading({ label = 'Loading your training log' }: { label?: string }) {
  return <div className="page-wrap" aria-label={label}><div className="skeleton" style={{ height: 12, width: 110, marginBottom: 18 }}/><div className="skeleton" style={{ height: 48, width: '74%', marginBottom: 24 }}/><div className="skeleton" style={{ height: 150, marginBottom: 14 }}/><div className="skeleton" style={{ height: 104 }}/></div>;
}
export function QueryError({ retry }: { retry: () => void }) {
  return <div className="panel" style={{ padding: 22, textAlign: 'center' }}><CircleHelp size={24} color="hsl(var(--accent))"/><h3 style={{ margin: '10px 0 4px' }}>Couldn’t load this view</h3><p style={{ color: 'hsl(var(--muted-foreground))', margin: '0 0 14px', fontSize: 14 }}>Your saved training data has not been changed.</p><button className="btn btn-secondary" onClick={retry}>Try again</button></div>;
}
export function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="panel" style={{ padding: 26, textAlign: 'center' }}><div style={{ width: 48, height: 48, margin: '0 auto 14px', borderRadius: 16, display: 'grid', placeItems: 'center', background: 'hsl(var(--secondary))', color: 'hsl(var(--primary))' }}><Dumbbell size={21}/></div><strong>{title}</strong><p style={{ margin: '7px auto 16px', color: 'hsl(var(--muted-foreground))', maxWidth: 300, fontSize: 14 }}>{detail}</p>{action}</div>;
}
export function FieldLabel({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: 'grid', gap: 7, fontSize: 12, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{label}{children}</label>; }
export function ErrorNote({ message }: { message: string }) { return <div role="alert" style={{ color: 'hsl(var(--destructive))', fontSize: 13, marginTop: 9 }}>{message}</div>; }
