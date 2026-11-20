import {
  clearErrors,
  errorSummary,
  listErrors,
  listFlags,
  setFlag,
  type ErrorRow,
  type Flag,
} from '@mfe/api-client';
import { useAuth } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { Button, Table } from '@mfe/ui';
import { getInstance } from '@module-federation/enhanced/runtime';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { eventLog, subscribeEventLog } from './eventLog.ts';
import {
  releaseManifestUrl,
  releasesUrl,
  remoteEntry,
  remoteManifests,
  setRemoteEntry,
  subscribeRemotes,
  type RemoteName,
} from './remotes.ts';
import { pingRemote, sharedRows, type Ping, type ShareScope } from './inspector.ts';

const remotes = remoteManifests.map(({ name }) => name as RemoteName);

// Versions listed in <remote>/releases/index.json; any failure just means only dev is offered.
async function fetchVersions(name: RemoteName): Promise<string[]> {
  try {
    const res = await fetch(releasesUrl(name), { cache: 'no-store' });
    if (!res.ok) return [];
    return ((await res.json()) as { versions?: string[] }).versions ?? [];
  } catch {
    return [];
  }
}

function VersionSelect({ name }: { name: RemoteName }) {
  const [versions, setVersions] = useState<string[]>([]);
  const current = useSyncExternalStore(subscribeRemotes, () => remoteEntry(name));
  useEffect(() => {
    let active = true;
    void fetchVersions(name).then((v) => active && setVersions(v));
    return () => {
      active = false;
    };
  }, [name]);
  const value = versions.find((v) => current === releaseManifestUrl(name, v)) ?? '';
  return (
    <select
      className="ds1-input"
      aria-label={`${name} version`}
      value={value}
      onChange={(e) =>
        setRemoteEntry(name, e.target.value ? releaseManifestUrl(name, e.target.value) : null)
      }
    >
      <option value="">dev</option>
      {versions.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

const readShared = () => sharedRows(getInstance()?.shareScopeMap.default as ShareScope | undefined);

function Flags({ flags, setFlags }: { flags: Flag[]; setFlags: Dispatch<SetStateAction<Flag[]>> }) {
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [failed, setFailed] = useState(false);
  const signedIn = user !== null;

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    listFlags().then(
      (f) => active && (setFlags(f), setFailed(false)),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [signedIn, setFlags]);

  async function toggle(name: string, enabled: boolean) {
    try {
      const updated = await setFlag(name, enabled);
      emit('flags:changed', { name, enabled: updated.enabled });
      emit('a11y:announce', { message: `${name} turned ${updated.enabled ? 'on' : 'off'}` });
      setFlags((all) => all.map((f) => (f.name === name ? updated : f)));
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="panel">
      <h2>Flags</h2>
      {!signedIn ? (
        <p className="panel-body">Sign in to see flags</p>
      ) : (
        <>
          {failed && (
            <p role="alert" className="panel-body">
              Could not load or change flags
            </p>
          )}
          <Table label="Flags">
            <thead>
              <tr>
                <th>Flag</th>
                <th>Enabled</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.name}>
                  <td className="ds1-mono">{f.name}</td>
                  <td>
                    <input
                      type="checkbox"
                      className="switch"
                      aria-label={f.name}
                      checked={f.enabled}
                      disabled={!isAdmin}
                      onChange={(e) => void toggle(f.name, e.target.checked)}
                    />
                  </td>
                  <td>{f.description}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </section>
  );
}

function Errors() {
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const [summary, setSummary] = useState<{ remote: string; count: number }[]>([]);
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [failed, setFailed] = useState(false);

  const refresh = () =>
    Promise.all([errorSummary(), listErrors()]).then(
      ([s, r]) => (setSummary(s), setRows(r.slice(0, 20)), setFailed(false)),
      () => setFailed(true),
    );
  const clear = () =>
    clearErrors().then(
      () => (
        setSummary([]),
        setRows([]),
        setFailed(false),
        emit('a11y:announce', { message: 'Errors cleared' })
      ),
      () => setFailed(true),
    );

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin]);

  return (
    <section className="panel">
      <h2>Errors</h2>
      {!isAdmin ? (
        <p className="panel-body">Admins only</p>
      ) : (
        <>
          {failed && <p className="panel-body">Could not load errors</p>}
          <div className="panel-body panel-toolbar">
            <ul className="chips">
              {summary.map((s) => (
                <li key={s.remote} className="chip chip--down mono">{`${s.remote}: ${s.count}`}</li>
              ))}
            </ul>
            <Button className="ds1-button--sm" onClick={() => void refresh()}>
              Refresh
            </Button>
            <Button className="ds1-button--sm" onClick={() => void clear()}>
              Clear
            </Button>
          </div>
          <Table label="Errors">
            <thead>
              <tr>
                <th>Time</th>
                <th>Remote</th>
                <th>Build</th>
                <th>Kind</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>No errors</td>
                </tr>
              )}
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="ds1-mono">{new Date(e.at).toLocaleTimeString('en-GB')}</td>
                  <td>{e.remote}</td>
                  <td className="ds1-mono">{e.build}</td>
                  <td>
                    <span className="chip chip--down">{e.kind}</span>
                  </td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </section>
  );
}

export default function InspectorPage() {
  const events = useSyncExternalStore(subscribeEventLog, eventLog);
  const [pings, setPings] = useState<Record<string, Ping>>({});
  // Re-run the ping effect (and show the right Manifest) whenever a selection changes.
  const entries = useSyncExternalStore(subscribeRemotes, () =>
    remotes.map((n) => remoteEntry(n)).join('|'),
  );
  const [rows, setRows] = useState(readShared);
  const user = useAuth((s) => s.user);
  const [flags, setFlags] = useState<Flag[]>([]);

  useEffect(() => {
    let active = true;
    const tick = () => {
      setRows(readShared());
      for (const name of remotes) {
        void pingRemote(remoteEntry(name)).then(
          (p) => active && setPings((s) => ({ ...s, [name]: p })),
        );
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [entries]);

  const upCount = remotes.filter((n) => pings[n]?.status === 'up').length;
  const allOnce = rows.length > 0 && rows.every((r) => r.loaded.length === 1);

  return (
    <>
      <div className="page-head">
        <h1 tabIndex={-1}>Federation inspector</h1>
        <p className="lead">
          Live state of this page: remotes, shared modules, flags, errors and events.
        </p>
      </div>
      <dl className="ds1-readings readings">
        <div>
          <dt>Remotes up</dt>
          <dd>{`${upCount}/${remotes.length}`}</dd>
        </div>
        <div>
          <dt>Shared modules</dt>
          <dd>
            {rows.length}
            {allOnce && <span className="reading-note">loaded once</span>}
          </dd>
        </div>
        <div>
          <dt>Flags on</dt>
          <dd>{user ? `${flags.filter((f) => f.enabled).length}/${flags.length}` : '—'}</dd>
        </div>
        <div>
          <dt>Events</dt>
          <dd>{events.length}</dd>
        </div>
      </dl>
      <section className="panel">
        <h2>Remotes</h2>
        <Table label="Remotes">
          <thead>
            <tr>
              <th>Name</th>
              <th>Manifest</th>
              <th>Version</th>
              <th>Status</th>
              <th>Use</th>
            </tr>
          </thead>
          <tbody>
            {remotes.map((name) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="ds1-mono manifest">{remoteEntry(name)}</td>
                <td className="ds1-mono">{pings[name]?.version ?? '—'}</td>
                <td>
                  <span className={`chip chip--${pings[name]?.status ?? 'idle'}`}>
                    {pings[name]?.status ?? 'checking…'}
                  </span>
                </td>
                <td>
                  <VersionSelect name={name} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section className="panel">
        <h2>Shared dependencies</h2>
        <Table label="Shared dependencies">
          <thead>
            <tr>
              <th>Package</th>
              <th>Required</th>
              <th>Loaded</th>
              <th>Singleton</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>No shared modules registered yet</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="ds1-mono">{r.required}</td>
                <td className="ds1-mono">{r.loaded.join(', ') || '—'}</td>
                <td>
                  <span className="chip">{r.singleton ? 'yes' : 'no'}</span>
                </td>
                <td>
                  <span className={`chip ${r.loaded.length === 1 ? 'chip--up' : ''}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <Flags flags={flags} setFlags={setFlags} />
      <Errors />
      <section className="panel">
        <h2>Events</h2>
        <Table className="trail" label="Events">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">
                  No events yet
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={`${e.at}-${e.name}-${JSON.stringify(e.detail)}`}>
                <td className="ds1-mono time">{new Date(e.at).toLocaleTimeString('en-GB')}</td>
                <td className="ds1-mono">{e.name}</td>
                <td className="ds1-mono payload">
                  <code>{JSON.stringify(e.detail)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section className="panel">
        <h2>How to break this</h2>
        <ol className="panel-body">
          <li>
            Stop a remote dev server: its status turns to down, the frame shows the fallback and the
            rest of the shell keeps working.
          </li>
          <li>
            Remove <code>singleton: true</code> for react in <code>federation.shared.ts</code>: a
            second React loads and hooks throw &quot;Invalid hook call&quot;.
          </li>
          <li>
            Rebuild only one remote: its build stamp changes here and in its frame, while the shell
            stamp stays the same.
          </li>
          <li>
            Set a <code>requiredVersion</code> the host cannot satisfy: watch the console warning.
          </li>
        </ol>
      </section>
    </>
  );
}
