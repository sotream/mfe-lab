import {
  clearErrors,
  errorSummary,
  listErrors,
  listFlags,
  setFlag,
  updateRegistry,
  type ErrorRow,
  type Flag,
} from '@mfe/api-client';
import { useAuth } from '@mfe/auth-store/react';
import { emit } from '@mfe/events';
import { Button, formatTime, Table, useLocale } from '@mfe/ui';
import { getInstance } from '@module-federation/enhanced/runtime';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useT } from './messages.ts';
import { eventLog, subscribeEventLog } from './eventLog.ts';
import {
  applyRegistryRow,
  describeRemote,
  registryAvailable,
  registryRow,
  registryVersion,
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
  const t = useT().inspector;
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
      aria-label={t.versionOf(name)}
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

// Variant and, for admins, the editable registry fields of one remote (RFC 0017).
function RegistryCells({ name }: { name: RemoteName }) {
  const tt = useT();
  const t = tt.inspector;
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  useSyncExternalStore(subscribeRemotes, registryVersion);
  const row = registryRow(name);
  const { shown, bucket } = describeRemote(name);
  const [url, setUrl] = useState(row?.canaryUrl ?? '');
  const [percent, setPercent] = useState(String(row?.canaryPercent ?? 0));
  const [failed, setFailed] = useState(false);
  const loaded = row !== undefined;

  async function save(patch: {
    canaryUrl?: string | null;
    canaryPercent?: number;
    disabled?: boolean;
  }) {
    try {
      const updated = await updateRegistry(name, patch);
      applyRegistryRow(updated);
      setFailed(false);
      emit('a11y:announce', { message: tt.inspector.registrySaved(name) });
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <td>
        <span className={`chip ${shown === 'stable' ? '' : 'chip--down'}`}>
          {t.variantNames[shown]}
        </span>
      </td>
      <td className="ds1-mono">{bucket ?? '—'}</td>
      {isAdmin && loaded ? (
        <>
          <td>
            <input
              className="ds1-input ds1-mono"
              type="url"
              aria-label={t.canaryUrlOf(name)}
              placeholder="https://…/mf-manifest.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </td>
          <td>
            <input
              className="ds1-input ds1-mono"
              type="number"
              min={0}
              max={100}
              step={1}
              aria-label={t.canaryPercentOf(name)}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </td>
          <td>
            <input
              type="checkbox"
              className="switch"
              aria-label={t.offOf(name)}
              checked={row.disabled}
              onChange={(e) => void save({ disabled: e.target.checked })}
            />
          </td>
          <td>
            <Button
              className="ds1-button--sm"
              aria-label={t.saveOf(name)}
              onClick={() =>
                void save({ canaryUrl: url.trim() || null, canaryPercent: Number(percent) })
              }
            >
              {t.save}
            </Button>
            {failed && <span role="alert">{t.registryFailed}</span>}
          </td>
        </>
      ) : (
        <>
          <td className="ds1-mono manifest">{row?.canaryUrl ?? '—'}</td>
          <td className="ds1-mono">{row ? row.canaryPercent : '—'}</td>
          <td>{row ? (row.disabled ? t.variantNames.disabled : '—') : '—'}</td>
          <td />
        </>
      )}
    </>
  );
}

const readShared = () => sharedRows(getInstance()?.shareScopeMap.default as ShareScope | undefined);

function Flags({ flags, setFlags }: { flags: Flag[]; setFlags: Dispatch<SetStateAction<Flag[]>> }) {
  const tt = useT();
  const t = tt.inspector;
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
      emit('a11y:announce', { message: tt.flagToggled(name, updated.enabled) });
      setFlags((all) => all.map((f) => (f.name === name ? updated : f)));
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="panel">
      <h2>{t.flags}</h2>
      {!signedIn ? (
        <p className="panel-body">{t.signInFlags}</p>
      ) : (
        <>
          {failed && (
            <p role="alert" className="panel-body">
              {t.flagsFailed}
            </p>
          )}
          <Table label={t.flags}>
            <thead>
              <tr>
                <th scope="col">{t.flag}</th>
                <th scope="col">{t.enabled}</th>
                <th scope="col">{t.description}</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.name}>
                  <th scope="row" className="ds1-mono">
                    {f.name}
                  </th>
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
  const tt = useT();
  const t = tt.inspector;
  const locale = useLocale();
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
        emit('a11y:announce', { message: tt.errorsCleared })
      ),
      () => setFailed(true),
    );

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin]);

  return (
    <section className="panel">
      <h2>{t.errors}</h2>
      {!isAdmin ? (
        <p className="panel-body">{t.adminsOnly}</p>
      ) : (
        <>
          {failed && <p className="panel-body">{t.errorsFailed}</p>}
          <div className="panel-body panel-toolbar">
            <ul className="chips">
              {summary.map((s) => (
                <li key={s.remote} className="chip chip--down mono">{`${s.remote}: ${s.count}`}</li>
              ))}
            </ul>
            <Button className="ds1-button--sm" onClick={() => void refresh()}>
              {t.refresh}
            </Button>
            <Button className="ds1-button--sm" onClick={() => void clear()}>
              {t.clear}
            </Button>
          </div>
          <Table label={t.errors}>
            <thead>
              <tr>
                <th scope="col">{t.time}</th>
                <th scope="col">{t.remote}</th>
                <th scope="col">{t.build}</th>
                <th scope="col">{t.kind}</th>
                <th scope="col">{t.message}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>{t.noErrors}</td>
                </tr>
              )}
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="ds1-mono">
                    <time dateTime={new Date(e.at).toISOString()}>
                      {formatTime(new Date(e.at), locale)}
                    </time>
                  </td>
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
  const t = useT().inspector;
  const locale = useLocale();
  const events = useSyncExternalStore(subscribeEventLog, eventLog);
  const [pings, setPings] = useState<Record<string, Ping>>({});
  // Re-run the ping effect (and show the right Manifest) whenever a selection changes.
  const entries = useSyncExternalStore(subscribeRemotes, () =>
    remotes.map((n) => remoteEntry(n)).join('|'),
  );
  useSyncExternalStore(subscribeRemotes, registryVersion);
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
        <h1 tabIndex={-1}>{t.h1}</h1>
        <p className="lead">{t.lead}</p>
      </div>
      <dl className="ds1-readings readings">
        <div>
          <dt>{t.remotesUp}</dt>
          <dd>{`${upCount}/${remotes.length}`}</dd>
        </div>
        <div>
          <dt>{t.sharedModules}</dt>
          <dd>
            {rows.length}
            {allOnce && <span className="reading-note">{t.loadedOnce}</span>}
          </dd>
        </div>
        <div>
          <dt>{t.flagsOn}</dt>
          <dd>{user ? `${flags.filter((f) => f.enabled).length}/${flags.length}` : '—'}</dd>
        </div>
        <div>
          <dt>{t.events}</dt>
          <dd>{events.length}</dd>
        </div>
      </dl>
      <section className="panel">
        <h2>{t.remotes}</h2>
        <Table label={t.remotes}>
          <thead>
            <tr>
              <th scope="col">{t.name}</th>
              <th scope="col">{t.manifest}</th>
              <th scope="col">{t.version}</th>
              <th scope="col">{t.status}</th>
              <th scope="col">{t.use}</th>
              <th scope="col">{t.variant}</th>
              <th scope="col">{t.bucket}</th>
              <th scope="col">{t.canaryUrl}</th>
              <th scope="col">{t.canaryPercent}</th>
              <th scope="col">{t.off}</th>
              <th scope="col">{t.save}</th>
            </tr>
          </thead>
          <tbody>
            {remotes.map((name) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td className="ds1-mono manifest">{remoteEntry(name)}</td>
                <td className="ds1-mono">{pings[name]?.version ?? '—'}</td>
                <td>
                  <span className={`chip chip--${pings[name]?.status ?? 'idle'}`}>
                    {pings[name] ? t[pings[name].status] : t.checking}
                  </span>
                </td>
                <td>
                  <VersionSelect name={name} />
                </td>
                <RegistryCells
                  // A saved or reloaded row remounts the cells, so the inputs show what the server holds.
                  key={`${registryRow(name)?.canaryUrl}|${registryRow(name)?.canaryPercent}`}
                  name={name}
                />
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="panel-body">
          {registryAvailable() === false ? t.registryUnavailable : t.registryHint}
        </p>
      </section>
      <section className="panel">
        <h2>{t.shared}</h2>
        <Table label={t.shared}>
          <thead>
            <tr>
              <th scope="col">{t.pkg}</th>
              <th scope="col">{t.required}</th>
              <th scope="col">{t.loaded}</th>
              <th scope="col">{t.singleton}</th>
              <th scope="col">{t.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>{t.noShared}</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td className="ds1-mono">{r.required}</td>
                <td className="ds1-mono">{r.loaded.join(', ') || '—'}</td>
                <td>
                  <span className="chip">{r.singleton ? t.yes : t.no}</span>
                </td>
                <td>
                  <span className={`chip ${r.loaded.length === 1 ? 'chip--up' : ''}`}>
                    {r.loaded.length === 0 ? t.notLoaded : t.loadedN(r.loaded.length)}
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
        <h2>{t.events}</h2>
        <Table className="trail" label={t.events}>
          <thead>
            <tr>
              <th scope="col">{t.time}</th>
              <th scope="col">{t.event}</th>
              <th scope="col">{t.payload}</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">
                  {t.noEvents}
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={`${e.at}-${e.name}-${JSON.stringify(e.detail)}`}>
                <td className="ds1-mono time">
                  <time dateTime={new Date(e.at).toISOString()}>
                    {formatTime(new Date(e.at), locale)}
                  </time>
                </td>
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
        <h2>{t.breakTitle}</h2>
        <ol className="panel-body">
          <li>{t.break1}</li>
          <li>
            {t.break2a}
            <code>singleton: true</code>
            {t.break2b}
            <code>federation.shared.ts</code>
            {t.break2c}
          </li>
          <li>{t.break3}</li>
          <li>
            {t.break4a}
            <code>requiredVersion</code>
            {t.break4b}
          </li>
        </ol>
      </section>
    </>
  );
}
