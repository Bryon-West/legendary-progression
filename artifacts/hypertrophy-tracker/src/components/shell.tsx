import type { ReactNode } from 'react';
import { BarChart3, CalendarDays, Dumbbell, History, Home, MessageSquareText, UserRound } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { useActiveProfile } from '@/lib/profile';

export function Shell({ children }: { children: ReactNode }) {
  const { profile } = useActiveProfile();
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
  return <div className="app-shell" data-training-mode={profile?.trainingMode ?? 'legendary_pro'}>
    <header className="topbar">
      <div className="topbar-inner" style={{ maxWidth: 720, margin: 'auto', padding: '10px 13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 auto' }}>
          <span className="brand-wordmark">LEGENDARY PROGRESSION</span>
        </Link>
        {profile && <Link href="/feedback" className="topbar-feedback" data-testid="link-beta-feedback" aria-label="Feedback" title="Feedback">
          <MessageSquareText size={18} aria-hidden="true" />
          <span>FEEDBACK</span>
        </Link>}
      </div>
    </header>
    <nav className="bottom-nav" aria-label="Main navigation">
      {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`nav-item ${location === href || (href !== '/' && location.startsWith(href)) ? 'active' : ''}`} style={{ fontSize: 9 }}><Icon size={18}/><span>{label}</span></Link>)}
    </nav>
    {children}
  </div>;
}
