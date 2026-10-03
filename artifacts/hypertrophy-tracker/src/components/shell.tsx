import type { ReactNode } from 'react';
import { BarChart3, CalendarDays, ChevronDown, Dumbbell, History, Home, UserRound } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { useActiveProfile } from '@/lib/profile';

export function Shell({ children }: { children: ReactNode }) {
  const { profile, profiles, setProfileId, unit } = useActiveProfile();
  const [location] = useLocation();
  useHealthCheck();
  const nav = [
    { href: '/', label: 'Today', icon: Home },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/history', label: 'Log', icon: History },
    { href: '/exercises', label: 'Library', icon: Dumbbell },
    { href: '/splits', label: 'Plans', icon: BarChart3 },
    { href: '/profiles', label: 'Profile', icon: UserRound },
  ];
  return <div className="app-shell">
    <header className="topbar">
      <div style={{ maxWidth: 720, margin: 'auto', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 auto' }}>
          <span className="brand-wordmark">LEGENDARY PROGRESSION</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7, minWidth: 0, flex: '0 1 170px' }}>
          {profile && <Link href="/profiles" className="badge badge-red" data-testid="badge-unit" style={{ textDecoration: 'none' }} aria-label={`Weight unit ${unit}`}>{unit}</Link>}
          <label aria-label="Choose training profile" style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <select data-testid="select-active-profile" className="field" style={{ width: '100%', minWidth: 0, minHeight: 40, padding: '0 30px 0 12px', borderRadius: 12, appearance: 'none', fontSize: 13, fontWeight: 700 }}
              value={profile?.id ?? ''} onChange={(e) => { const id = Number(e.target.value); setProfileId(id); window.localStorage.setItem('training-profile', String(id)); }}>
              {profiles.length ? profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">No profile</option>}
            </select><ChevronDown size={14} style={{ position: 'absolute', right: 10, pointerEvents: 'none' }}/>
          </label>
        </div>
      </div>
    </header>
    <nav className="bottom-nav" aria-label="Main navigation">
      {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`nav-item ${location === href || (href !== '/' && location.startsWith(href)) ? 'active' : ''}`} style={{ fontSize: 9 }}><Icon size={18}/><span>{label}</span></Link>)}
    </nav>
    {children}
  </div>;
}
