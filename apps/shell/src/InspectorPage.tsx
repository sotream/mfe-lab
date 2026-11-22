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
import { canAdmin } from '@mfe/auth-store';
import { useAuth } from '@mfe/auth-store/react';
import { emit } from '@mfe/events';
import '@mfe/ui/select.css';
import '@mfe/ui/tooltip.css';
import {
  BuildStamp,
  Button,
  Field,
  formatTime,
  MiddleTruncate,
  Select,
  Table,
  Tooltip,
  useLocale,
} from '@mfe/ui';
import { getInstance } from '@module-federation/enhanced/runtime';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type FormEvent,
  type ReactNode,
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
  stableUrl,
  setRemoteEntry,
  subscribeRemotes,
  type RemoteName,
} from './remotes.ts';
import { pingRemote, sharedRows, type Ping, type ShareScope } from './inspector.ts';

// Header with a keyboard-reachable info hint.
function HintTh({ label, hint }: { label: string; hint: string }) {
  return (
    <th scope="col" className="hint-th">
      {label}{' '}
      {/* The name is the column; the hint reaches assistive tech once, through the tooltip's aria-describedby. */}
      <Tooltip tabStop role="img" aria-label={label} className="hint" content={hint}>
        i
      </Tooltip>
    </th>
  );
}

const Manifest = ({ url }: { url?: string | null }) =>
  url ? <MiddleTruncate text={url} /> : <>—</>;

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
    <Select
      aria-label={t.versionOf(name)}
      value={value}
      options={[
        { value: '', label: t.devOption },
        ...versions.map((v) => ({ value: v, label: v })),
      ]}
      onChange={(v) => setRemoteEntry(name, v ? releaseManifestUrl(name, v) : null)}
    />
  );
}

// Native <dialog>, opened modally on mount (jsdom has no showModal). Closing unmounts it, so focus
// goes back to the row's Details button by hand, as in the products dialog (T26).
function Modal({
  title,
  onClose,
  returnTo,
  children,
}: {
  title: string;
  onClose: () => void;
  returnTo: () => HTMLElement | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => returnTo()?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- returnTo is read once, on unmount
  }, []);
  return (
    <dialog ref={ref} className="details-dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

// Full values of one remote; for admins also the registry form (RFC 0017).
function DetailsDialog({
  name,
  ping,
  onClose,
}: {
  name: RemoteName;
  ping?: Ping;
  onClose: () => void;
}) {
  const t = useT().inspector;
  const demoNote = useT().demoAdmin;
  const isAdmin = useAuth((s) => canAdmin(s.user));
  const locked = useAuth((s) => s.user?.demo === true);
  useSyncExternalStore(subscribeRemotes, registryVersion);
  const row = registryRow(name);
  const { shown, entry, bucket } = describeRemote(name);
  const [url, setUrl] = useState(row?.canaryUrl ?? '');
  const [percent, setPercent] = useState(String(row?.canaryPercent ?? 0));
  const [off, setOff] = useState(row?.disabled ?? false);
  const [failed, setFailed] = useState(false);
  const urlRow = (label: string, value: string | null | undefined) => (
    <>
      <dt>{label}</dt>
      <dd className="ds1-mono">
        {value ? (
          <>
            {value}{' '}
            <Button
              className="ds1-button--sm"
              aria-label={t.copyOf(label)}
              onClick={() =>
                void navigator.clipboard
                  .writeText(value)
                  .then(() => emit('a11y:announce', { message: t.copied }))
              }
            >
              {t.copy}
            </Button>
          </>
        ) : (
          t.none
        )}
      </dd>
    </>
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const updated = await updateRegistry(name, {
        canaryUrl: url.trim() || null,
        canaryPercent: Number(percent),
        disabled: off,
      });
      applyRegistryRow(updated);
      emit('a11y:announce', { message: t.registrySaved(name) });
      onClose();
    } catch {
      setFailed(true);
    }
  }

  return (
    <Modal
      title={t.detailsTitle(name)}
      onClose={onClose}
      returnTo={() => document.getElementById(`details-${name}`)}
    >
      <dl className="details-list">
        {urlRow(t.stableManifest, stableUrl(name))}
        {urlRow(t.canaryUrl, row?.canaryUrl)}
        <dt>{t.inUse}</dt>
        <dd className="ds1-mono">{entry}</dd>
        <dt>{t.buildVersion}</dt>
        <dd className="ds1-mono">{ping?.version ?? '—'}</dd>
        <dt>{t.variant}</dt>
        <dd>{t.variantNames[shown]}</dd>
        <dt>{t.bucket}</dt>
        <dd className="ds1-mono">{bucket ?? '—'}</dd>
        <dt>{t.status}</dt>
        <dd>{ping ? t[ping.status] : t.checking}</dd>
      </dl>
      {isAdmin && row ? (
        <form onSubmit={(e) => void save(e)} className="details-form">
          <Field
            label={t.canaryUrlOf(name)}
            type="url"
            placeholder="https://…/mf-manifest.json"
            value={url}
            disabled={locked}
            aria-disabled={locked || undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Field
            label={t.canaryPercentOf(name)}
            type="number"
            min={0}
            max={100}
            step={1}
            value={percent}
            disabled={locked}
            aria-disabled={locked || undefined}
            onChange={(e) => setPercent(e.target.value)}
          />
          <label className="details-off">
            <input
              type="checkbox"
              className="switch"
              checked={off}
              disabled={locked}
              aria-disabled={locked || undefined}
              onChange={(e) => setOff(e.target.checked)}
            />
            {t.offOf(name)}
          </label>
          <p className="details-hint">{t.registryHint}</p>
          {locked && <p className="details-demo">{demoNote}</p>}
          {failed && <p role="alert">{t.registryFailed}</p>}
          <div className="details-actions">
            <Button onClick={onClose}>{t.cancel}</Button>
            <Button
              type="submit"
              variant="primary"
              aria-label={t.saveOf(name)}
              disabled={locked}
              aria-disabled={locked || undefined}
            >
              {t.save}
            </Button>
          </div>
        </form>
      ) : (
        <div className="details-actions">
          <Button onClick={onClose}>{t.close}</Button>
        </div>
      )}
    </Modal>
  );
}

// Two lines per cell: the value, then a muted detail (RFC 0017 state lives in the registry row).
function RemoteRow({ name, ping, onOpen }: { name: RemoteName; ping?: Ping; onOpen: () => void }) {
  const t = useT().inspector;
  useSyncExternalStore(subscribeRemotes, registryVersion);
  const row = registryRow(name);
  const { shown, bucket } = describeRemote(name);
  const rollout = !row
    ? '—'
    : row.disabled
      ? t.variantNames.disabled
      : row.canaryUrl
        ? t.canaryAt(row.canaryPercent)
        : '—';
  return (
    // A click on the plain part of the row opens Details; controls and tooltip triggers keep their own click.
    // The Details button is the keyboard and screen-reader way in.
    <tr
      className="remote-row"
      onClick={(e) => {
        // The table's scroll region is focusable too, so only a match inside this row counts.
        const control = (e.target as HTMLElement).closest(
          'button,input,select,a,[tabindex],[role=listbox]',
        );
        if (!control || !e.currentTarget.contains(control)) onOpen();
      }}
    >
      <th scope="row">
        {name}
        <span className="sub">
          <span className={`chip chip--${ping?.status ?? 'idle'}`}>
            {ping ? t[ping.status] : t.checking}
          </span>
        </span>
      </th>
      <td className="ds1-mono manifest">
        <Manifest url={stableUrl(name)} />
        <span className="sub">
          {row?.canaryUrl && (
            <>
              <span className="sub-label">{t.variantNames.canary}</span>
              <MiddleTruncate text={row.canaryUrl} />
            </>
          )}
        </span>
      </td>
      <td className="ds1-mono">
        {ping?.version ? <BuildStamp v={ping.version} /> : '—'}
        <span className="sub">
          <span className={`chip ${shown === 'stable' ? '' : 'chip--down'}`}>
            {t.variantNames[shown]}
          </span>
          {bucket !== null && ` · ${bucket}`}
        </span>
      </td>
      <td>
        <VersionSelect name={name} />
      </td>
      <td>
        {rollout}
        <span className="sub">
          <Button
            id={`details-${name}`}
            className="ds1-button--sm"
            aria-label={t.detailsOf(name)}
            onClick={onOpen}
          >
            {t.details}
          </Button>
        </span>
      </td>
    </tr>
  );
}

const readShared = () => sharedRows(getInstance()?.shareScopeMap.default as ShareScope | undefined);

function Flags({ flags, setFlags }: { flags: Flag[]; setFlags: Dispatch<SetStateAction<Flag[]>> }) {
  const tt = useT();
  const t = tt.inspector;
  const user = useAuth((s) => s.user);
  const isAdmin = canAdmin(user);
  const locked = user?.demo === true;
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const signedIn = user !== null;

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    listFlags().then(
      (f) => active && (setFlags(f), setFailed(false), setLoaded(true)),
      () => active && (setFailed(true), setLoaded(true)),
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
          {locked && <p className="panel-body details-demo">{tt.demoAdmin}</p>}
          {failed && (
            <p role="alert" className="panel-body">
              {t.flagsFailed}
            </p>
          )}
          {!loaded && (
            <p role="status" className="visually-hidden">
              {t.loading}
            </p>
          )}
          <Table
            label={t.flags}
            loading={loaded ? undefined : { rows: 3, cols: 3, rowHeight: 47.5 }}
          >
            <thead>
              <tr>
                <th scope="col">{t.flag}</th>
                <th scope="col">{t.enabled}</th>
                <th scope="col">{t.description}</th>
              </tr>
            </thead>
            {loaded && (
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
                        disabled={!isAdmin || locked}
                        aria-disabled={locked || undefined}
                        onChange={(e) => void toggle(f.name, e.target.checked)}
                      />
                    </td>
                    <td>{t.flagDescriptions[f.name] ?? f.description}</td>
                  </tr>
                ))}
              </tbody>
            )}
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
  const isAdmin = useAuth((s) => canAdmin(s.user));
  const locked = useAuth((s) => s.user?.demo === true);
  const [summary, setSummary] = useState<{ remote: string; count: number }[]>([]);
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = () =>
    Promise.all([errorSummary(), listErrors()]).then(
      ([s, r]) => (setSummary(s), setRows(r.slice(0, 20)), setFailed(false), setLoaded(true)),
      () => (setFailed(true), setLoaded(true)),
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
          {locked && <p className="panel-body details-demo">{tt.demoAdmin}</p>}
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
            <Button
              className="ds1-button--sm"
              disabled={locked}
              aria-disabled={locked || undefined}
              onClick={() => void clear()}
            >
              {t.clear}
            </Button>
          </div>
          {!loaded && (
            <p role="status" className="visually-hidden">
              {t.loading}
            </p>
          )}
          <Table label={t.errors} loading={loaded ? undefined : { rows: 1, cols: 5 }}>
            <thead>
              <tr>
                <th scope="col">{t.time}</th>
                <th scope="col">{t.remote}</th>
                <th scope="col">{t.build}</th>
                <th scope="col">{t.kind}</th>
                <th scope="col">{t.message}</th>
              </tr>
            </thead>
            {loaded && (
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
                      <span className="chip chip--down">
                        {(t.kinds as Record<string, string>)[e.kind] ?? e.kind}
                      </span>
                    </td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            )}
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
  const registryState = useSyncExternalStore(subscribeRemotes, registryVersion);
  const [rows, setRows] = useState(readShared);
  const user = useAuth((s) => s.user);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [details, setDetails] = useState<RemoteName | null>(null);

  useEffect(() => {
    let active = true;
    const tick = () => {
      setRows(readShared());
      for (const name of remotes) {
        // A remote the registry switched off is not fetched; it just reads "off".
        if (describeRemote(name).shown === 'disabled') {
          setPings((s) => ({ ...s, [name]: { status: 'off', version: null } }));
          continue;
        }
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
  }, [entries, registryState]);

  // Until the first ping answers, status cells are unknown: show the tables as skeletons.
  const pending = Object.keys(pings).length === 0;
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
        <Table className="remotes" label={t.remotes}>
          <thead>
            <tr>
              <th scope="col">{t.remote}</th>
              <HintTh label={t.manifest} hint={t.manifestHint} />
              <th scope="col">{t.build}</th>
              <th scope="col">{t.use}</th>
              <HintTh label={t.rollout} hint={t.rolloutHint} />
            </tr>
          </thead>
          <tbody>
            {remotes.map((name) => (
              <RemoteRow
                key={name}
                name={name}
                ping={pings[name]}
                onOpen={() => setDetails(name)}
              />
            ))}
          </tbody>
        </Table>
        <p className="panel-body">
          {registryAvailable() === false ? t.registryUnavailable : t.useHint}
        </p>
      </section>
      {details && (
        <DetailsDialog
          key={details}
          name={details}
          ping={pings[details]}
          onClose={() => setDetails(null)}
        />
      )}
      <section className="panel">
        <h2>{t.shared}</h2>
        <Table
          label={t.shared}
          loading={pending && rows.length === 0 ? { rows: 3, cols: 5, rowHeight: 41 } : undefined}
        >
          <thead>
            <tr>
              <th scope="col">{t.pkg}</th>
              <th scope="col">{t.required}</th>
              <th scope="col">{t.loaded}</th>
              <th scope="col">{t.singleton}</th>
              <th scope="col">{t.status}</th>
            </tr>
          </thead>
          {!(pending && rows.length === 0) && (
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
          )}
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
