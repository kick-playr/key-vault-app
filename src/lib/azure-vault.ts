import type { VaultScope } from './inventory';
export interface VaultVersion {
  version: string;
  attributes: { enabled: boolean; created?: number; updated?: number; nbf?: number; exp?: number };
  tags?: Record<string, string>;
  contentType?: string;
}
export function decodeSecretFile(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > 25600) throw Error('Choose a nonempty UTF-8 file up to 25 KiB.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw Error('The file must contain valid UTF-8 text.'); }
}
export function utcEpoch(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw Error('Enter a valid UTC date and time.');
  const canonical = value.length === 16 ? value + ':00' : value;
  const epoch = Date.parse(canonical + 'Z');
  if (!Number.isFinite(epoch) || epoch < 0 || new Date(epoch).toISOString().slice(0,19) !== canonical) throw Error('Enter a valid UTC date and time on or after 1970.');
  return epoch / 1000;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid version metadata.');
  return value as Record<string, unknown>;
}
export function parseVersions(payload: unknown, kind: 'keys'|'secrets', scope: VaultScope, name: string): VaultVersion[] {
  const rows = record(payload).value;
  if (!Array.isArray(rows)) throw Error('Invalid version history.');
  const seen = new Set<string>();
  return rows.map(raw => {
    const row = record(raw), id = row[kind === 'keys' ? 'kid' : 'id'];
    if (typeof id !== 'string') throw Error('Missing version identifier.');
    const url = new URL(id);
    const prefix = `/namespaces/${scope.environment}/${scope.tenant}/${kind}/${name}/`;
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) throw Error('Version belongs to a different namespace.');
    const version = url.pathname.slice(prefix.length);
    if (!/^[A-Za-z0-9-]{1,128}$/.test(version) || seen.has(version)) throw Error('Invalid version identifier.');
    seen.add(version);
    const attrs = record(row.attributes);
    if (typeof attrs.enabled !== 'boolean') throw Error('Invalid version status.');
    const attributes: VaultVersion['attributes'] = { enabled: attrs.enabled };
    for (const key of ['created','updated','nbf','exp'] as const) {
      if (attrs[key] !== undefined) {
        if (!Number.isSafeInteger(attrs[key]) || (attrs[key] as number) < 0) throw Error('Invalid version date.');
        attributes[key] = attrs[key] as number;
      }
    }
    let tags: Record<string,string> | undefined;
    if (row.tags !== undefined) {
      const candidate = record(row.tags);
      if (Object.keys(candidate).length > 15 || Object.entries(candidate).some(([k,v])=>k.length>512 || typeof v !== 'string' || v.length>512)) throw Error('Invalid version tags.');
      tags = Object.fromEntries(Object.entries(candidate)) as Record<string,string>;
    }
    if (row.contentType !== undefined && (typeof row.contentType !== 'string' || row.contentType.length > 255)) throw Error('Invalid content type.');
    return { version, attributes, ...(tags ? { tags } : {}), ...(kind === 'secrets' && row.contentType !== undefined ? { contentType: row.contentType as string } : {}) };
  });
}
