import { getInstance } from '@module-federation/enhanced/runtime';
import { useEffect, useState } from 'react';
import { remoteManifests as remotes } from './remotes.ts';
import { pingRemote, sharedRows, type Ping, type ShareScope } from './inspector.ts';

const readShared = () => sharedRows(getInstance()?.shareScopeMap.default as ShareScope | undefined);

export default function InspectorPage() {
  const [pings, setPings] = useState<Record<string, Ping>>({});
  const [rows, setRows] = useState(readShared);

  useEffect(() => {
    let active = true;
    const tick = () => {
      setRows(readShared());
      for (const { name, manifest } of remotes) {
        void pingRemote(manifest).then((p) => active && setPings((s) => ({ ...s, [name]: p })));
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

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
          </tr>
        </thead>
        <tbody>
          {remotes.map(({ name, manifest }) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{manifest}</td>
              <td>{pings[name]?.version ?? '—'}</td>
              <td>{pings[name]?.status ?? 'checking…'}</td>
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
