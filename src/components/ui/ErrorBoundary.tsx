import { Component, type ReactNode } from 'react';
import { isChunkError, refreshAndReload } from '../../lib/recover';

interface Props {
  children: ReactNode;
  /** Layout flavour: the whole app, or just the page area (header stays usable). */
  scope?: 'app' | 'page';
}
interface State {
  error: Error | null;
  recovering: boolean;
}

/** A render error anywhere below used to unmount the whole app (blank page). Now it shows what happened and how to get going again. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[RAX] render error:', error);
    if (isChunkError(error)) {
      this.setState({ recovering: true });
      void refreshAndReload().then((ok) => !ok && this.setState({ recovering: false }));
    }
  }

  render() {
    const { error, recovering } = this.state;
    if (!error) return this.props.children;
    const app = this.props.scope === 'app';
    return (
      <div role="alert" className={`mx-auto max-w-xl rounded-lg border border-line bg-surface p-5 text-sm ${app ? 'mt-24' : 'my-8'}`}>
        <h2 className="text-base font-semibold text-head">{recovering ? 'Updating to the latest version…' : 'Something went wrong on this page'}</h2>
        {!recovering && (
          <>
            <p className="mt-2 text-muted">
              {isChunkError(error)
                ? 'A file from an older version of the site could not be loaded — reloading usually fixes it.'
                : 'The rest of the site is fine. Try again, or reload the page. Your saved settings were not touched.'}
            </p>
            <pre className="num mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-base p-2 text-[11px] text-muted">{String(error.message).slice(0, 300)}</pre>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
              <button className="btn-ghost" onClick={() => void refreshAndReload().then((ok) => !ok && location.reload())}>Reload</button>
            </div>
          </>
        )}
      </div>
    );
  }
}
