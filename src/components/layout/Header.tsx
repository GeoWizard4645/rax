import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="border-b border-line bg-surface/70 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <Link to="/" className="flex items-center gap-2.5 !text-head no-underline">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-line bg-base font-mono text-sm font-bold text-emerald">R</span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-wide">RAX</span>
            <span className="block text-[11px] text-muted">RealApp Super-Suite</span>
          </span>
        </Link>
        <span className="hidden text-[11px] text-muted sm:block">Unofficial · not affiliated with Real</span>
      </div>
    </header>
  );
}
