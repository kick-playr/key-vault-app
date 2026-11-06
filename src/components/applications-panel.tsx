'use client';
import { VAULT_UI_REQUEST_TIMEOUT_MS } from "../lib/vault-request";
import { ApplicationLinksTable } from './application-links-table';
import { parseVersions } from '../lib/azure-vault';
import { DiscardDialog } from './discard-dialog';
import React, { useEffect, useRef, useState } from 'react';
import {
  parseRuntimeStatus,
  type ReportedRuntimeStatus,
  parseApplications,
  type ApplicationsModel,
} from '../lib/applications';
import {
  parseInventory,
  continuationPath,
  type InventoryRow,
} from '../lib/inventory';
type Connection = { environment: string; tenant: string; token: string };
function errorMessage(status: number): string {
  return status === 403
    ? 'Your grant does not have permission for this application or namespace. Tenant links also require catalog list permission in _shared.'
    : status === 409
      ? 'The model changed or this ENV name conflicts with an existing mapping. Reload before saving again.'
      : status === 404
        ? 'The application, resource or selected version was not found.'
        : status === 400
          ? 'Check the application name, canonical ENV name and selected version.'
          : 'The vault request failed. Reload to check the saved model before retrying.';
}
export function ApplicationsPanel({
  connection,
  onDirty,
  onUnauthorized,
}: {
  connection: Connection;
  onDirty?: (dirty: boolean) => void;
  onUnauthorized?: () => void;
}) {
  const [model, setModel] = useState<ApplicationsModel>();
  const [selected, setSelected] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<ReportedRuntimeStatus>();
  const [runtimeStatusFailed, setRuntimeStatusFailed] = useState(false);
  const authFailure = useRef(onUnauthorized);
  authFailure.current = onUnauthorized;
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [createName, setCreateName] = useState('');
  const [createLabel, setCreateLabel] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [tableEpoch, setTableEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = useRef(false);
  const dirtyAreas = useRef(new Set<string>());
  const catalogToken = useRef<HTMLInputElement>(null);
  const [deletion, setDeletion] = useState<{
    key: string;
    revision: number;
    inUse: boolean;
    verified: boolean;
    links: number;
    manifests: number;
    instances: number;
    pending: number;
    name: string;
  }>();
  const deleteCancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!deletion) return;
    const previous = document.activeElement as HTMLElement | null;
    deleteCancel.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [deletion?.key]);
  const deletionKey = JSON.stringify([
    connection.environment,
    connection.tenant,
    selected,
  ]);
  useEffect(
    () => setDeletion(undefined),
    [connection.environment, connection.tenant, connection.token, selected],
  );
  async function checkDeletion() {
    if (!model || !selected) return;
    const { c, id } = start();
    try {
      const usage = await read(
        'local/applications/' + encodeURIComponent(selected) + '/usage',
        c.signal,
      );
      if (!current(id)) return;
      if (
        typeof usage.verified !== 'boolean' ||
        typeof usage.inUse !== 'boolean' ||
        !['links', 'manifests', 'instances', 'pending'].every(
          (k) => Number.isSafeInteger(usage[k]) && usage[k] >= 0,
        )
      )
        throw Error('Cannot verify application usage.');
      setDeletion({
        key: deletionKey,
        revision: model.revision,
        verified: usage.verified,
        inUse:
          usage.inUse ||
          usage.links + usage.manifests + usage.instances + usage.pending > 0,
        links: usage.links,
        manifests: usage.manifests,
        instances: usage.instances,
        pending: usage.pending,
        name: '',
      });
    } catch (e) {
      if (current(id) && !c.signal.aborted)
        setError(
          e instanceof Error ? e.message : 'Cannot verify application usage.',
        );
    } finally {
      if (current(id)) setBusy(false);
    }
  }
  async function confirmDeletion() {
    if (
      !deletion ||
      deletion.key !== deletionKey ||
      deletion.inUse ||
      !deletion.verified ||
      deletion.name !== selected ||
      deletion.revision !== model?.revision
    )
      return;
    if (
      await mutate(
        'local/applications/' + encodeURIComponent(selected),
        { confirmName: selected },
        'DELETE',
        'delete',
      )
    ) {
      setDeletion(undefined);
      setSelected('');
      setNotice('Application deleted. Secrets and keys were kept.');
    }
  }
  const [pendingAction, setPendingAction] = useState<() => void>();
  function markDirty(value: boolean, area = 'link') {
    if (value) dirtyAreas.current.add(area);
    else dirtyAreas.current.clear();
    dirty.current = dirtyAreas.current.size > 0;
    onDirty?.(dirty.current);
  }
  function guarded(action: () => void) {
    if (dirty.current) setPendingAction(() => action);
    else action();
  }
  const [conflicted, setConflicted] = useState(false);
  const active = useRef(true),
    controller = useRef<AbortController | null>(null),
    sequence = useRef(0);
  const app = model?.applications.find((a) => a.name === selected);
  const isShared = connection.tenant === '_shared';
  const applicationsLabel = isShared ? 'Applications' : 'Assigned applications';
  const headers = {
    'x-vault-token': connection.token,
    'x-vault-environment': connection.environment,
    'x-vault-tenant': connection.tenant,
  };
  async function read(
    path: string,
    signal: AbortSignal,
    method = 'GET',
    body?: unknown,
  ) {
    const response = await fetch('/api/vault/' + path, {
      method,
      headers: {
        ...headers,
        ...(method === 'PUT' &&
        (path.includes('/resources/') || path.endsWith('/resources')) &&
        catalogToken.current?.value
          ? { 'x-vault-catalog-token': catalogToken.current.value }
          : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(VAULT_UI_REQUEST_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      if (response.status === 409) setConflicted(true);
      const problem=await response.json().catch(()=>null);
      const code=problem?.error?.code;
      if(code==='ApplicationInUse')throw Error('Application is now in use. Deletion is blocked. Reload and check usage again.');
      if(code==='ApplicationUsageUnavailable')throw Error('Usage could not be verified. Deletion is blocked.');
      throw Error(errorMessage(response.status));
    }
    return response.json();
  }
  function start() {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const id = ++sequence.current;
    setBusy(true);
    setError('');
    return { c, id };
  }
  function current(id: number) {
    return active.current && sequence.current === id;
  }
  async function load() {
    const { c, id } = start();
    try {
      const [raw, items] = await Promise.all([
        read('local/applications', c.signal),
        read('local/inventory?maxresults=25', c.signal),
      ]);
      const m = parseApplications(raw, connection);
      let rows = parseInventory(items, 'local/inventory', connection);
      const inventoryRows = [...rows.rows],
        seen = new Set<string>();
      // Search must cover the namespace, not only the first transport page.
      while (rows.nextLink) {
        const path = continuationPath(
          rows.nextLink,
          'local/inventory',
          connection,
        );
        if (seen.has(path)) throw Error('Invalid inventory continuation.');
        seen.add(path);
        rows = parseInventory(
          await read(path, c.signal),
          'local/inventory',
          connection,
        );
        inventoryRows.push(...rows.rows);
      }
      if (!current(id)) return;
      setModel(m);
      setInventory(inventoryRows);
      setConflicted(false);
      setNotice('');
      markDirty(false);
      setTableEpoch((v) => v + 1);
      const fresh = m.applications.find((a) => a.name === selected);
      setSelected(fresh?.name ?? '');
      setDisplayName(fresh?.displayName ?? '');
      setDescription(fresh?.description ?? '');
      setCreateName('');
      setCreateLabel('');
      setCreateDescription('');
      setShowCreate(false);

      if (catalogToken.current) catalogToken.current.value = '';
    } catch (e) {
      if (current(id) && !c.signal.aborted)
        setError(e instanceof Error ? e.message : 'Cannot load applications.');
    } finally {
      if (current(id)) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      sequence.current++;
      controller.current?.abort();
    };
  }, [connection.environment, connection.tenant, connection.token]); // Connection changes remount the panel.
  useEffect(() => {
    setRuntimeStatus(undefined);
    setRuntimeStatusFailed(false);
    if (!selected) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch(
          '/api/vault/local/applications/' +
            encodeURIComponent(selected) +
            '/status',
          {
            headers: {
              'x-vault-token': connection.token,
              'x-vault-environment': connection.environment,
              'x-vault-tenant': connection.tenant,
            },
            cache: 'no-store',
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(VAULT_UI_REQUEST_TIMEOUT_MS)]),
          },
        );
        if (cancelled) return;
        if (response.status === 401) {
          authFailure.current?.();
          return;
        }
        if (!response.ok) throw Error('Status unavailable');
        const report = parseRuntimeStatus(await response.json());
        if (!cancelled) {
          setRuntimeStatus(report);
          setRuntimeStatusFailed(false);
        }
      } catch {
        if (!cancelled) setRuntimeStatusFailed(true);
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 1000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [selected, connection.environment, connection.tenant, connection.token]);
  async function mutate(
    path: string,
    fields: Record<string, unknown>,
    method = 'PUT',
    area = path.includes('/resources/') || path.endsWith('/resources')
      ? method === 'DELETE'
        ? 'unlink'
        : 'link'
      : 'details',
  ) {
    if (!model || conflicted) return;
    const { c, id } = start();
    setNotice('');
    try {
      const raw = await read(path, c.signal, method, {
        ...fields,
        expectedRevision: model.revision,
      });
      const nextModel = parseApplications(raw, connection);
      if (!current(id)) return;
      setModel(nextModel);
      setNotice('Saved model. Check consumer reports for runtime adoption.');
      dirtyAreas.current.delete(area);
      dirty.current = dirtyAreas.current.size > 0;
      onDirty?.(dirty.current);
      if (area === 'create') {
        setSelected(createName);
        setDisplayName(createLabel);
        setDescription(createDescription);
        setTableEpoch(v => v + 1);
        setShowCreate(false);
        setCreateName('');
        setCreateLabel('');
        setCreateDescription('');
      }

      return true;
    } catch (e) {
      if (current(id) && !c.signal.aborted)
        setError(e instanceof Error ? e.message : 'Cannot save application.');
    } finally {
      if (catalogToken.current) catalogToken.current.value = '';
      if (current(id)) setBusy(false);
    }
  }
  function select(name: string) {
    setShowCreate(false);
    setCreateName('');
    setCreateLabel('');
    setCreateDescription('');
    const a = model?.applications.find((x) => x.name === name);
    setSelected(name);
    setTableEpoch((value) => value + 1);
    setDisplayName(a?.displayName ?? '');
    setDescription(a?.description ?? '');

    markDirty(false);
  }
  return (
    <div className="applications-layout">
      {pendingAction && (
        <DiscardDialog
          onStay={() => setPendingAction(undefined)}
          onDiscard={() => {
            const action = pendingAction;
            setPendingAction(undefined);
            markDirty(false);
            action();
          }}
        />
      )}
      <section className="panel applications-toolbar">
        <div>
          <h2>{applicationsLabel}</h2>
          <p>
            {isShared ? 'Manage global application definitions and shared resource links in' : 'Manage resource links for applications assigned to'}{' '}
            <strong>
              {connection.environment} / {connection.tenant}
            </strong>
            . Links never grant access.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => guarded(() => void load())}
        >
          Reload applications
        </button>
      </section>
      {error && (
        <div role="alert" className="error-message">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Loading…</p>}
      {model && (
        <>
          <section className="panel applications-catalog">
            <div className="applications-catalog-heading">
              <div>
                <h2>{isShared ? 'Application list' : 'Assigned applications'}</h2>
                <p>{isShared ? 'Select an application to manage its global details and shared resource links.' : 'Select an assigned application to manage its resource links in this tenant. Global definitions are managed in _shared.'}</p>
              </div>
              {isShared && <button type="button" className="primary-button"
                disabled={busy || conflicted} aria-expanded={showCreate} aria-controls="application-create-form"
                onClick={() => guarded(() => { select(''); setShowCreate(true); })}>
                New application
              </button>}
            </div>
            {!model.applications.length ? <p>{isShared ? 'No global applications yet.' : 'No assigned applications in this tenant.'}</p> : (
              <div className="applications-catalog-scroll">
                <table className="applications-catalog-table" aria-label={applicationsLabel}>
                  <thead><tr><th scope="col">Application</th><th scope="col">Slug</th><th scope="col">Description</th><th scope="col">Linked resources</th></tr></thead>
                  <tbody>{model.applications.map(a => (
                    <tr key={a.name} className={selected === a.name ? 'is-selected' : ''}>
                      <th scope="row"><button type="button" className="secondary-button" aria-pressed={selected === a.name} disabled={busy}
                        onClick={() => guarded(() => select(a.name))}>{a.displayName}</button></th>
                      <td><code>{a.name}</code></td>
                      <td>{a.description || <span className="application-empty-description">No description</span>}</td>
                      <td>{a.resources.length}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {isShared ? showCreate && (
              <form id="application-create-form" className="application-create-form"
                onChange={() => markDirty(true, 'create')}
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(
                    'local/applications/' + encodeURIComponent(createName),
                    { displayName: createLabel, description: createDescription },
                    'PUT',
                    'create',
                  );
                }}
              >
                <h3>Create application</h3>
                <label>
                  Application slug
                  <input
                    autoFocus
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    pattern="[a-z][a-z0-9-]{0,63}"
                    maxLength={64}
                    required
                    placeholder="club-api"
                  />
                </label>
                <label>
                  Display name
                  <input
                    value={createLabel}
                    onChange={(e) => setCreateLabel(e.target.value)}
                    maxLength={128}
                    required
                    placeholder="Club API"
                  />
                </label>
                <label>
                  Description
                  <input value={createDescription} onChange={e => setCreateDescription(e.target.value)}
                    maxLength={512} placeholder="What this application does and which secrets it uses" />
                </label>
                <div className="application-create-actions">
                  <button className="primary-button" disabled={busy || conflicted}>Create application</button>
                  <button type="button" className="secondary-button" disabled={busy}
                    onClick={() => guarded(() => select(''))}>Cancel</button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  guarded(() => select(createName));
                }}
              >
                <p>
                  Application records are created in _shared. This view contains
                  only links in this tenant. Linking also requires a catalog
                  list token for _shared; enter it below when linking.
                </p>
                <label>
                  Existing application name
                  <input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    pattern="[a-z][a-z0-9-]{0,63}"
                    required
                  />
                </label>
                <button className="secondary-button" disabled={busy}>
                  Model tenant links
                </button>
              </form>
            )}
          </section>
          {selected && (
            <section
              className="panel application-detail"
              aria-label="Application details"
            >
              <h2>{app?.displayName ?? selected}</h2>
              <p>
                <code>{selected}</code> · {connection.environment} /{' '}
                {connection.tenant}
              </p>
              {isShared && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || conflicted}
                  onClick={() => guarded(() => void checkDeletion())}
                >
                  Delete application
                </button>
              )}
              {deletion?.key === deletionKey && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Delete application"
                  className="azure-confirm"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setDeletion(undefined);
                    }
                    if (e.key === 'Tab') {
                      const items =
                        e.currentTarget.querySelectorAll<HTMLElement>(
                          'button:not(:disabled),input',
                        );
                      const first = items[0],
                        last = items[items.length - 1];
                      if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last?.focus();
                      } else if (
                        !e.shiftKey &&
                        document.activeElement === last
                      ) {
                        e.preventDefault();
                        first?.focus();
                      }
                    }
                  }}
                >
                  <h3>Delete {app?.displayName ?? selected}?</h3>
                  {!deletion.verified ? (
                    <p>
                      Usage could not be fully verified. Deletion is blocked.
                    </p>
                  ) : deletion.inUse ? (
                    <p>
                      Application is in use. Deletion is blocked:{' '}
                      {deletion.links} secret/key links, {deletion.manifests}{' '}
                      runtime enrollments, {deletion.instances} active
                      consumers, {deletion.pending} pending changes. Remove its
                      usage before trying again.
                    </p>
                  ) : (
                    <>
                      <p>No usage found. Secrets and keys will be kept.</p>
                      <label>
                        Type application name to confirm
                        <input
                          value={deletion.name}
                          onChange={(e) =>
                            setDeletion({ ...deletion, name: e.target.value })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={
                          busy ||
                          deletion.name !== selected ||
                          deletion.revision !== model?.revision
                        }
                        onClick={() => void confirmDeletion()}
                      >
                        Confirm deletion
                      </button>
                    </>
                  )}
                  <button
                    ref={deleteCancel}
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setDeletion(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <div className="application-status" role="status">
                {runtimeStatusFailed ? (
                  <p>
                    Runtime status is unavailable. Earlier reports may be out of
                    date.
                  </p>
                ) : runtimeStatus?.state === 'applied' ? (
                  <p>
                    Applied by{' '}
                    {
                      runtimeStatus.instances.filter(
                        (i) => i.expiresAt > Date.now(),
                      ).length
                    }{' '}
                    reporting instance
                    {runtimeStatus.instances.filter(
                      (i) => i.expiresAt > Date.now(),
                    ).length === 1
                      ? ''
                      : 's'}
                    .
                  </p>
                ) : runtimeStatus?.state === 'warning' ? (
                  <p>
                    Update warning: a consumer reports it is using its previous
                    working configuration.
                  </p>
                ) : runtimeStatus?.state === 'blocked' ? (
                  <p>
                    Runtime update is blocked. Check resource validity,
                    permissions and migration support.
                  </p>
                ) : runtimeStatus?.state === 'updating' ? (
                  <p>
                    Updating — waiting for consumers to acknowledge this
                    configuration.
                  </p>
                ) : runtimeStatus?.state === 'offline' ? (
                  <p>
                    Consumers are offline or their reports have expired.
                    Application is not confirmed updated.
                  </p>
                ) : (
                  <p>
                    No runtime reports connected. Saving links does not confirm
                    a running application has applied them.
                  </p>
                )}
                {runtimeStatus && runtimeStatus.instances.length > 0 && (
                  <details>
                    <summary>Consumer reports</summary>
                    {runtimeStatus.instances.map((i) => (
                      <p key={i.instanceId}>
                        <code>{i.instanceId}</code> ·{' '}
                        {i.expiresAt <= Date.now() ? 'offline' : i.status} ·
                        Last seen {new Date(i.lastSeen).toLocaleTimeString()}
                      </p>
                    ))}
                    <p>
                      These are authenticated consumer reports, not independent
                      security attestations.
                    </p>
                  </details>
                )}
              </div>
              {app && !app.supported && (
                <p>
                  No compatible consumer registered. You can model links before
                  connecting a supported consumer.
                </p>
              )}
              {app && isShared && (
                <form
                  onChange={() => markDirty(true, 'details')}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(
                      'local/applications/' + encodeURIComponent(selected),
                      { displayName, description },
                    );
                  }}
                >
                  <label>
                    Application display name
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={128}
                      required
                    />
                  </label>
                  <label>
                    Description
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={512}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={busy || conflicted}
                  >
                    Save application
                  </button>
                </form>
              )}
              {isShared &&
                app &&
                (app.liveEnabled ? (
                  <p>
                    Live configuration enabled. Check consumer reports for
                    adoption.
                  </p>
                ) : (
                  <details>
                    <summary>Use live configuration</summary>
                    <p>
                      This explicitly switches updated consumers from startup
                      configuration to these UI links. Saving a model alone does
                      not switch them. Older consumers need the updated adapter.
                      This switch cannot be reversed here; encryption-key
                      changes still require safe migration.
                    </p>
                    <p>Save or reload any unsaved edits before activating.</p>
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        conflicted ||
                        !app.supported ||
                        !app.resources.length
                      }
                      onClick={() => {
                        if (dirty.current) {
                          setError(
                            'Save or reload unsaved edits before activating.',
                          );
                          return;
                        }
                        void mutate(
                          'local/applications/' +
                            encodeURIComponent(selected) +
                            '/activate',
                          {},
                          'PUT',
                          'activation',
                        );
                      }}
                    >
                      Activate live configuration
                    </button>
                  </details>
                ))}
              {!isShared && (
                <label>
                  Application catalog token (_shared)
                  <input
                    ref={catalogToken}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Separate catalog list token, if needed"
                  />
                </label>
              )}
              <ApplicationLinksTable
                key={`${selected}/${tableEpoch}`}
                application={selected}
                inventory={inventory}
                resources={app?.resources ?? []}
                canonicalResources={model.applications.flatMap(
                  (a) => a.resources,
                )}
                disabled={busy || conflicted}
                onDirty={(value) => {
                  if (value) markDirty(true, 'link');
                  else {
                    dirtyAreas.current.delete('link');
                    dirty.current = dirtyAreas.current.size > 0;
                    onDirty?.(dirty.current);
                  }
                }}
                onSave={(updates) =>
                  mutate(
                    `local/applications/${encodeURIComponent(selected)}/resources`,
                    { updates },
                    'PUT',
                    'link',
                  )
                }
                loadVersions={async (kind, name, signal) =>
                  parseVersions(
                    await read(
                      `${kind}/${encodeURIComponent(name)}/versions`,
                      signal,
                    ),
                    kind,
                    connection,
                    name,
                  )
                }
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
