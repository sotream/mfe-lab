import { getInstance } from '@module-federation/enhanced/runtime';
import { useEffect, useState, useSyncExternalStore } from 'react';
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

export default function InspectorPage() {
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
