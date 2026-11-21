import { Component, Suspense, use, useState, type ComponentType, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { useT } from './messages.ts';
import './frame.css';

export type RemoteModule = { default: ComponentType; buildVersion?: string };

export type FrameError = {
  remote: string;
  build: string;
  kind: 'render' | 'load';
  message: string;
  stack?: string;
};

type Props = {
  name: string;
  // Header label: `origin` as is, else `:${port}`, else none.
  origin?: string;
  port?: number;
  load: () => Promise<RemoteModule>;
  // Optional so that ui does not depend on @mfe/telemetry; the shell passes `report`.
  report?: (e: FrameError) => void;
};

// Build of each module that resolved; a boundary catch with no entry here was a load failure.
const builds = new WeakMap<Promise<RemoteModule>, string>();

// A rejection is handled here: `use` reads the promise, the boundary renders the fallback.
function start(load: Props['load']): Promise<RemoteModule> {
  const p = load();
  p.then(
    (m) => builds.set(p, m.buildVersion ?? 'unknown'),
    () => {},
  );
  return p;
}

function Remote({ promise }: { promise: Promise<RemoteModule> }) {
  const { default: Page, buildVersion } = use(promise);
  return (
    <>
      {buildVersion && <span className="remote-frame-build">{`build ${buildVersion}`}</span>}
      <div className="remote-frame-body">
        <Page />
      </div>
    </>
  );
}

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error('[RemoteFrame]', error);
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Not React.lazy: it caches a rejection forever. Here Retry calls load() again.
export function RemoteFrame({ name, origin, port, load, report }: Props) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [promise, setPromise] = useState(() => start(load));

  const retry = () => {
    setPromise(start(load));
    setAttempt(attempt + 1);
  };

  const onError = (error: unknown) => {
    const build = builds.get(promise);
    const e = error instanceof Error ? error : new Error(String(error));
    report?.({
      remote: name,
      build: build ?? 'unknown',
      kind: build === undefined ? 'load' : 'render',
      message: e.message,
      stack: e.stack,
    });
  };

  return (
    <section data-remote={name} aria-label={t.remote(name)}>
      <h2 className="remote-frame-label">{name}</h2>
      {(origin ?? port) !== undefined && (
        <span className="remote-frame-port">{origin ?? `:${port}`}</span>
      )}
      <Boundary
        key={attempt}
        onError={onError}
        fallback={
          <div
            role="alert"
            className="remote-frame-error"
            // After a failed Retry the boundary remounts this fallback: put focus back on Retry, not body.
            ref={(el) => {
              if (attempt > 0) el?.querySelector('button')?.focus();
            }}
          >
            <p>{t.unavailable(name)}</p>
            <Button onClick={retry}>{t.retry}</Button>
          </div>
        }
      >
        <Suspense
          fallback={
            <p role="status" className="remote-frame-body">
              {t.loading(name)}
            </p>
          }
        >
          <Remote promise={promise} />
        </Suspense>
      </Boundary>
    </section>
  );
}
