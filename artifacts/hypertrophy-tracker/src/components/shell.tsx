import type { ReactNode } from 'react';
import { BarChart3, CalendarDays, Dumbbell, History, Home, UserRound } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { useActiveProfile } from '@/lib/profile';

export function Shell({ children }: { children: ReactNode }) {
  const { profile, unit } = useActiveProfile();
  const [location] = useLocation();
  useHealthCheck();
  const nav = [
    { href: '/', label: 'Today', icon: Home },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/history', label: 'Log', icon: History },
    { href: '/exercises', label: 'Library', icon: Dumbbell },
    ...(profile?.trainingMode === 'basic' ? [] : [{ href: '/splits', label: 'Plans', icon: BarChart3 }]),
    { href: '/profiles', label: 'Profile', icon: UserRound },
  ];
  return <div className="app-shell">
    <header className="topbar">
      <div style={{ maxWidth: 720, margin: 'auto', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 auto' }}>
          <span className="brand-wordmark">LEGENDARY PROGRESSION</span>
        </Link>
        {profile && <Link href="/profiles" className="badge badge-red" data-testid="badge-unit" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} aria-label={`Profile settings, weight unit ${unit}`}>
          <UserRound size={13}/>{unit}
        </Link>}
      </div>
    </header>
    <nav className="bottom-nav" aria-label="Main navigation">
      {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`nav-item ${location === href || (href !== '/' && location.startsWith(href)) ? 'active' : ''}`} style={{ fontSize: 9 }}><Icon size={18}/><span>{label}</span></Link>)}
    </nav>
    {children}
  </div>;
}
