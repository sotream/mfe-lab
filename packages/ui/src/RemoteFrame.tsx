import { Component, Suspense, use, useState, type ComponentType, type ReactNode } from 'react';
import './frame.css';

export type RemoteModule = { default: ComponentType; buildVersion?: string };

type Props = { name: string; port: number; load: () => Promise<RemoteModule> };

// A rejection is handled here: `use` reads the promise, the boundary renders the fallback.
function start(load: Props['load']): Promise<RemoteModule> {
  const p = load();
  p.catch(() => {});
  return p;
}

function Remote({ promise }: { promise: Promise<RemoteModule> }) {
  const { default: Page, buildVersion } = use(promise);
  return (
    <>
      {buildVersion && <span className="remote-frame-build">{`build ${buildVersion}`}</span>}
      <Page />
    </>
  );
}

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error('[RemoteFrame]', error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Not React.lazy: it caches a rejection forever. Here Retry calls load() again.
export function RemoteFrame({ name, port, load }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [promise, setPromise] = useState(() => start(load));

  const retry = () => {
    setPromise(start(load));
    setAttempt(attempt + 1);
  };

  return (
    <section data-remote={name} aria-label={`${name} remote`}>
      <span className="remote-frame-label">{`${name} · :${port}`}</span>
      <Boundary
        key={attempt}
        fallback={
          <div role="alert" className="remote-frame-error">
            <p>{`${name} is unavailable`}</p>
            <button onClick={retry}>Retry</button>
          </div>
        }
      >
        <Suspense fallback={<p role="status">{`Loading ${name}…`}</p>}>
          <Remote promise={promise} />
        </Suspense>
      </Boundary>
    </section>
  );
}
