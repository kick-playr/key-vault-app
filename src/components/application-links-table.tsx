'use client';
import { secretValueFormatLabel, type SecretValueFormat } from '../lib/secret-value-format';
import React, { useEffect, useRef, useState } from 'react';
import type { InventoryRow } from '../lib/inventory';
import type { ApplicationResource } from '../lib/applications';
import type { VaultVersion } from '../lib/azure-vault';
export interface LinkUpdate {
  kind: 'keys' | 'secrets';
  name: string;
  selected: boolean;
  envName?: string;
  version?: string;
}
type Row = {
  valueFormat?: SecretValueFormat;
  kind: 'keys' | 'secrets';
  name: string;
  purpose: string;
  version?: string;
  missing?: boolean;
  canonical?: string;
  others: string[];
  linked?: ApplicationResource;
};
type Draft = { selected: boolean; envName: string; version: string };
const initial = (row: Row): Draft => ({
  selected: !!row.linked,
  envName: row.canonical ?? '',
  version: row.linked?.policy ?? 'latest',
});
export function ApplicationLinksTable({
  inventory,
  resources,
  canonicalResources,
  disabled,
  onDirty,
  onSave,
  loadVersions,
  application = '',
}: {
  application?: string;
  inventory: InventoryRow[];
  resources: ApplicationResource[];
  canonicalResources: ApplicationResource[];
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  onSave: (updates: LinkUpdate[]) => Promise<boolean | undefined>;
  loadVersions: (
    kind: 'keys' | 'secrets',
    name: string,
    signal: AbortSignal,
  ) => Promise<VaultVersion[]>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [keySearch, setKeySearch] = useState(''),
    [envSearch, setEnvSearch] = useState(''),
    [page, setPage] = useState(0),
    [validationError, setValidationError] = useState('');
  const items = new Map<string, Row>();
  for (const item of inventory) {
    const kind = item.kind === 'secret' ? 'secrets' : 'keys';
    items.set(`${kind}/${item.name}`, {
      kind,
      name: item.name,
      purpose: item.purpose ?? item.tags?.purpose ?? `Unnamed ${item.kind}`,
      version: item.version,
      valueFormat: item.valueFormat,
      canonical: item.tags?.envName,
      others: [],
    });
  }
  for (const resource of resources) {
    const id = `${resource.kind}/${resource.name}`,
      old = items.get(id);
    items.set(id, {
      ...old,
      kind: resource.kind,
      name: resource.name,
      purpose:
        old?.purpose ??
        resource.tags.purpose ??
        `Unnamed ${resource.kind === 'secrets' ? 'secret' : 'key'}`,
      version: old?.version ?? resource.version,
      missing: resource.missing,
      canonical: resource.envName,
      others: [],
      linked: resource,
    });
  }
  for (const row of items.values()) {
    const canonical = canonicalResources.find(
      (r) => r.kind === row.kind && r.name === row.name,
    );
    row.canonical = canonical?.envName ?? row.canonical;
    row.others =
      canonical?.applications.filter((name) => name !== application) ?? [];
  }
  const rows = [...items.values()].sort(
    (a, b) =>
      a.purpose.localeCompare(b.purpose) || a.name.localeCompare(b.name),
  );
  const filtered = rows.filter(
    (row) =>
      (linkFilter === 'all' ||
        (drafts[`${row.kind}/${row.name}`]?.selected ?? !!row.linked) === (linkFilter === 'linked')) &&
      `${row.purpose} ${row.name}`
        .toLowerCase()
        .includes(keySearch.trim().toLowerCase()) &&
      (drafts[`${row.kind}/${row.name}`]?.envName ?? row.canonical ?? '')
        .toLowerCase()
        .includes(envSearch.trim().toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20)),
    currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  function update(row: Row, value: Partial<Draft>) {
    const id = `${row.kind}/${row.name}`,
      next = { ...(drafts[id] ?? initial(row)), ...value },
      copy = { ...drafts };
    if (
      (!next.selected && !row.linked) ||
      JSON.stringify(next) === JSON.stringify(initial(row))
    )
      delete copy[id];
    else copy[id] = next;
    setDrafts(copy);
    onDirty(Object.keys(copy).length > 0);
  }
  return (
    <form
      className="application-links-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const invalid = Object.entries(drafts).find(
          ([, draft]) =>
            draft.selected && !/^[A-Z][A-Z0-9_]{0,127}$/.test(draft.envName),
        );
        if (invalid) {
          const row = items.get(invalid[0]);
          setKeySearch(row?.name ?? '');
          setEnvSearch('');
          setPage(0);
          setValidationError(
            `Enter a valid ENV variable for ${row?.purpose ?? invalid[0]}.`,
          );
          return;
        }
        setValidationError('');
        const updates = Object.entries(drafts).map(
          ([id, draft]): LinkUpdate => {
            const [kind, name] = id.split('/') as ['keys' | 'secrets', string];
            return draft.selected
              ? {
                  kind,
                  name,
                  selected: true,
                  envName: draft.envName,
                  version: draft.version,
                }
              : { kind, name, selected: false };
          },
        );
        if (updates.length && (await onSave(updates))) {
          setDrafts({});
          onDirty(false);
        }
      }}
    >
      <h3>Secrets and keys</h3>
      <p>
        Select resources, choose Latest or an exact version, then save your
        links. Unchecking removes the link without deleting the resource.
      </p>
      <div className="application-links-scroll">
        <table
          className="application-links-table"
          aria-label="Application resource links"
        >
          <thead>
            <tr>
              <th scope="col">
                Link
                <div className="application-link-filters" role="group" aria-label="Filter resource links">
                  {(['linked', 'unlinked'] as const).map(filter => (
                    <button key={filter} type="button"
                      aria-label={filter === 'linked' ? 'Show used resources' : 'Show unused resources'}
                      title={filter === 'linked' ? 'Used by this application · click again to show all' : 'Unused by this application · click again to show all'}
                      aria-pressed={linkFilter === filter}
                      onClick={() => { setLinkFilter(linkFilter === filter ? 'all' : filter); setPage(0); }}>
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        {filter === 'linked' && <path d="m7 12 3 3 7-7" />}
                      </svg>
                    </button>
                  ))}
                </div>
              </th>
              <th scope="col">
                Secret / key purpose
                <input
                  type="search"
                  aria-label="Search key"
                  placeholder="Search key…"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                  value={keySearch}
                  onChange={(event) => {
                    setKeySearch(event.target.value);
                    setPage(0);
                  }}
                />
              </th>
              <th scope="col">ID</th>
              <th scope="col">Version</th>
              <th scope="col">
                ENV variable
                <input
                  type="search"
                  aria-label="Search ENV"
                  placeholder="Search ENV…"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                  value={envSearch}
                  onChange={(event) => {
                    setEnvSearch(event.target.value);
                    setPage(0);
                  }}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = `${row.kind}/${row.name}`,
                label =
                  rows.filter((r) => r.purpose === row.purpose).length > 1
                    ? `${row.purpose} (${row.kind === 'secrets' ? 'secret' : 'key'} ${row.name})`
                    : row.purpose;
              return (
                <ResourceRow
                  key={id}
                  row={row}
                  label={label}
                  draft={drafts[id] ?? initial(row)}
                  disabled={disabled}
                  update={(value) => update(row, value)}
                  loadVersions={loadVersions}
                />
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={5}>
                  {rows.length
                    ? 'No resources match these filters.'
                    : 'No secrets or keys in this namespace.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="application-links-pagination" aria-label="Resource pages">
        <span role="status">
          {filtered.length
            ? `${currentPage * 20 + 1}–${Math.min((currentPage + 1) * 20, filtered.length)} of ${filtered.length}`
            : '0 resources'}{' '}
          · Page {currentPage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous page
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={currentPage >= pageCount - 1}
          onClick={() => setPage(currentPage + 1)}
        >
          Next page
        </button>
      </nav>
      {validationError && <p role="alert">{validationError}</p>}
      <p>
        Shared resources use the same ENV name in every application. Keys remain
        non-exportable handles.
      </p>
      <button
        className="primary-button"
        disabled={disabled || !Object.keys(drafts).length}
      >
        Save links
      </button>
    </form>
  );
}
function ResourceRow({
  row,
  label,
  draft,
  disabled,
  update,
  loadVersions,
}: {
  row: Row;
  label: string;
  draft: Draft;
  disabled: boolean;
  update: (value: Partial<Draft>) => void;
  loadVersions: (
    kind: 'keys' | 'secrets',
    name: string,
    signal: AbortSignal,
  ) => Promise<VaultVersion[]>;
}) {
  const [versions, setVersions] = useState<VaultVersion[]>(),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load() {
    if (versions || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const values = await loadVersions(row.kind, row.name, controller.signal);
      if (!controller.signal.aborted) setVersions(values);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        request.current = null;
      }
    }
  }
  const available = [
    ...new Set([
      ...(versions ?? []).map((v) => v.version),
      ...(row.version ? [row.version] : []),
      ...(draft.version !== 'latest' ? [draft.version] : []),
    ]),
  ];
  const selectedVersion = draft.version === 'latest' ? versions?.at(-1)?.version ?? row.version : draft.version;
  const selectedFormat = versions?.find(v => v.version === selectedVersion)?.valueFormat
    ?? (selectedVersion === row.version ? row.valueFormat : undefined)
    ?? (selectedVersion === row.linked?.version ? row.linked?.valueFormat : undefined);
  return (
    <tr className={draft.selected ? 'is-linked' : ''}>
      <td>
        <input
          type="checkbox"
          aria-label={`Select ${label}`}
          checked={draft.selected}
          disabled={disabled || (!draft.selected && row.missing && !row.linked)}
          onChange={(e) => update({ selected: e.target.checked })}
        />
      </td>
      <th scope="row">
        <strong>{row.purpose}</strong>
        <small>
          {row.kind === 'secrets' ? 'Secret' : 'Key handle'}
          {row.missing ? ' · Missing resource' : ''}
        </small>
        {row.kind === 'secrets' && <small>Format: {secretValueFormatLabel(selectedFormat)}</small>}
        {row.others.length > 0 && (
          <small>Also used by: {row.others.join(', ')}</small>
        )}
      </th>
      <td>
        <code className="application-resource-id" title={row.name}>
          {row.name}
        </code>
      </td>
      <td>
        <select
          aria-label={`Version for ${label}`}
          value={draft.version}
          disabled={disabled || !draft.selected}
          onFocus={() => void load()}
          onChange={(e) => update({ version: e.target.value })}
        >
          <option value="latest">Latest</option>
          {available.map((version) => (
            <option key={version} value={version}>
              {version}
              {versions?.find((v) => v.version === version)?.attributes
                .enabled === false
                ? ' (disabled)'
                : ''}
            </option>
          ))}
        </select>
        {loading && <small role="status">Loading versions…</small>}
        {error && (
          <small role="alert">
            Cannot load version history. Check read permission.{' '}
            <button
              type="button"
              className="text-button"
              onClick={() => void load()}
            >
              Retry versions
            </button>
          </small>
        )}
      </td>
      <td>
        <input
          aria-label={`ENV variable for ${label}`}
          value={draft.envName}
          disabled={disabled || !draft.selected}
          readOnly={!!row.canonical}
          onChange={(e) => update({ envName: e.target.value })}
          required={draft.selected}
          pattern="[A-Z][A-Z0-9_]{0,127}"
          maxLength={128}
          placeholder="DATABASE_URL"
        />
        {row.canonical && <small>Shared ENV name</small>}
      </td>
    </tr>
  );
}
