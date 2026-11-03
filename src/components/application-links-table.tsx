'use client';
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
  const items = new Map<string, Row>();
  for (const item of inventory) {
    const kind = item.kind === 'secret' ? 'secrets' : 'keys';
    items.set(`${kind}/${item.name}`, {
      kind,
      name: item.name,
      purpose: item.purpose ?? item.tags?.purpose ?? `Unnamed ${item.kind}`,
      version: item.version,
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
              <th scope="col">Link</th>
              <th scope="col">Secret / key purpose</th>
              <th scope="col">ID</th>
              <th scope="col">Version</th>
              <th scope="col">ENV variable</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
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
            {!rows.length && (
              <tr>
                <td colSpan={5}>No secrets or keys in this namespace.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
