import { NavLink } from 'react-router-dom';
import { Activity, CalendarDays, Crosshair, Gauge, Gem, Scale, Users, Wallet } from 'lucide-react';

export const TABS = [
  // Numbers are fixed (not the position) so "Tab 7" etc. keep meaning the same thing; the old Tab 4 (OTD Rax) was retired —
  // Tab 7 (OTD Efficiency) replaces it.
  { n: 1, to: '/rateboard', label: 'Rateboard', icon: Gem },
  { n: 2, to: '/scout', label: 'Scout', icon: Crosshair },
  { n: 3, to: '/volatility', label: 'Volatility', icon: Activity },
  { n: 5, to: '/portfolio', label: 'Portfolio', icon: Wallet },
  { n: 6, to: '/quads', label: 'Quads', icon: Users },
  { n: 7, to: '/efficiency', label: 'OTD Efficiency', icon: Gauge },
  { n: 8, to: '/calendar', label: 'OTD Calendar', icon: CalendarDays },
  { n: 9, to: '/edge', label: 'Edge / EV', icon: Scale },
] as const;

export default function TabNav() {
  return (
    <nav aria-label="Main" className="sticky top-0 z-30 border-b border-line bg-base/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] gap-1 overflow-x-auto px-3 sm:px-4">
        {TABS.map(({ n, to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium !no-underline transition-colors ${
                isActive ? 'border-emerald text-head' : 'border-transparent text-muted hover:text-head'
              }`
            }
          >
            <span className="num text-[10px] text-muted">{n}</span>
            <Icon size={15} /> {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
