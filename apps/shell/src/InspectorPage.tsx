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
import { getInstance } from '@module-federation/enhanced/runtime';
import { useEffect, useState, useSyncExternalStore } from 'react';
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

function Flags() {
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [flags, setFlags] = useState<Flag[]>([]);
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
  }, [signedIn]);

  async function toggle(name: string, enabled: boolean) {
    try {
      const updated = await setFlag(name, enabled);
      emit('flags:changed', { name, enabled: updated.enabled });
      setFlags((all) => all.map((f) => (f.name === name ? updated : f)));
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <h2>Flags</h2>
      {!signedIn ? (
        <p>Sign in to see flags</p>
      ) : (
        <>
          {failed && <p role="alert">Could not load or change flags</p>}
          <table>
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
                  <td>{f.name}</td>
                  <td>
                    <input
                      type="checkbox"
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
          </table>
        </>
      )}
    </>
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
      () => (setSummary([]), setRows([]), setFailed(false)),
      () => setFailed(true),
    );

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin]);

  return (
    <>
      <h2>Errors</h2>
      {!isAdmin ? (
        <p>Admins only</p>
      ) : (
        <>
          {failed && <p>Could not load errors</p>}
          <ul>
            {summary.map((s) => (
              <li key={s.remote}>{`${s.remote}: ${s.count}`}</li>
            ))}
          </ul>
          <button onClick={() => void refresh()}>Refresh</button>
          <button onClick={() => void clear()}>Clear</button>
          <table>
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
                  <td>{new Date(e.at).toLocaleTimeString('en-GB')}</td>
                  <td>{e.remote}</td>
                  <td>{e.build}</td>
                  <td>{e.kind}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
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

  return (
    <>
      <h1>Federation inspector</h1>
      <h2>Remotes</h2>
      <table>
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
              <td>{remoteEntry(name)}</td>
              <td>{pings[name]?.version ?? '—'}</td>
              <td>{pings[name]?.status ?? 'checking…'}</td>
              <td>
                <VersionSelect name={name} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Shared dependencies</h2>
      <table>
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
              <td>{r.required}</td>
              <td>{r.loaded.join(', ') || '—'}</td>
              <td>{r.singleton ? 'yes' : 'no'}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Flags />
      <Errors />
      <h2>Events</h2>
      <table>
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
              <td colSpan={3}>No events yet</td>
            </tr>
          )}
          {events.map((e) => (
            <tr key={`${e.at}-${e.name}-${JSON.stringify(e.detail)}`}>
              <td>{new Date(e.at).toLocaleTimeString('en-GB')}</td>
              <td>{e.name}</td>
              <td>
                <code>{JSON.stringify(e.detail)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>How to break this</h2>
      <ol>
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
    </>
  );
}
