export default function Footer() {
  return (
    <footer className="border-t border-line px-3 py-4 text-center text-[11px] leading-relaxed text-muted sm:px-4">
      <p>
        Unofficial fan tool — not affiliated with or endorsed by Real. Panels marked <span className="chip-amber">SAMPLE DATA</span> are synthetic; nothing here is financial advice.
      </p>
      <p className="mt-1">
        Tab 1 is a window onto{' '}
        <a href="https://rateboard-cgi.pages.dev" target="_blank" rel="noopener noreferrer">
          Rateboard ↗
        </a>
        , which owns all of its data and rules.
      </p>
    </footer>
  );
}
