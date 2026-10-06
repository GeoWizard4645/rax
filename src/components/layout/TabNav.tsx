import { NavLink } from 'react-router-dom';
import { Activity, CalendarClock, Crosshair, Gem, Users, Wallet } from 'lucide-react';

export const TABS = [
  { to: '/rateboard', label: 'Rateboard', icon: Gem },
  { to: '/scout', label: 'Scout', icon: Crosshair },
  { to: '/volatility', label: 'Volatility', icon: Activity },
  { to: '/otd', label: 'OTD Rax', icon: CalendarClock },
  { to: '/portfolio', label: 'Portfolio', icon: Wallet },
  { to: '/quads', label: 'Quads', icon: Users },
] as const;

export default function TabNav() {
  return (
    <nav aria-label="Main" className="sticky top-0 z-30 border-b border-line bg-base/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] gap-1 overflow-x-auto px-3 sm:px-4">
        {TABS.map(({ to, label, icon: Icon }, i) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium !no-underline transition-colors ${
                isActive ? 'border-emerald text-head' : 'border-transparent text-muted hover:text-head'
              }`
            }
          >
            <span className="num text-[10px] text-muted">{i + 1}</span>
            <Icon size={15} /> {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
