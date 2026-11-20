export type Ping = { status: 'up' | 'down'; version: string | null };

export async function pingRemote(manifestUrl: string): Promise<Ping> {
  try {
    const res = await fetch(manifestUrl, { cache: 'no-store' });
    if (!res.ok) return { status: 'down', version: null };
    const body = (await res.json()) as { metaData?: { buildInfo?: { buildVersion?: string } } };
    return { status: 'up', version: body?.metaData?.buildInfo?.buildVersion ?? null };
  } catch {
    return { status: 'down', version: null };
  }
}

export type SharedEntry = {
  from: string;
  loaded?: boolean;
  shareConfig?: { singleton?: boolean | number; requiredVersion?: string | false };
};
export type ShareScope = Record<string, Record<string, SharedEntry>>; // pkg -> version -> entry
export type SharedRow = {
  name: string;
  required: string;
  versions: string[];
  loaded: string[];
  singleton: boolean;
  status: string;
};

function status(n: number): string {
  if (n === 0) return 'not loaded';
  return n === 1 ? 'loaded once' : `loaded ${n} times`;
}

export function sharedRows(scope: ShareScope | undefined): SharedRow[] {
  return Object.entries(scope ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, byVersion]) => {
      const versions = Object.keys(byVersion).sort();
      const entries = Object.values(byVersion);
      const ref = entries.find((e) => e.from === 'shell') ?? entries[0];
      const loaded = versions.filter((v) => byVersion[v]?.loaded === true);
      return {
        name,
        required: ref?.shareConfig?.requiredVersion || '—',
        versions,
        loaded,
        // the live runtime stores singleton as 1, not true
        singleton: entries.some((e) => e.shareConfig?.singleton),
        status: status(loaded.length),
      };
    });
}
