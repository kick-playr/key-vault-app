'use client';
import { DiscardDialog } from './discard-dialog';
import React, { useEffect, useRef, useState } from 'react';
import {
  parseRuntimeStatus,
  type ReportedRuntimeStatus,
  parseApplications,
  type ApplicationsModel,
  type ApplicationResource,
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
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [next, setNext] = useState<string>();
  const [resource, setResource] = useState('');
  const [mapping, setMapping] = useState('');
  const [policy, setPolicy] = useState('latest');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = useRef(false);
  const dirtyAreas = useRef(new Set<string>());
  const catalogToken = useRef<HTMLInputElement>(null);
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
  const chosen = inventory.find(
    (r) => `${r.kind === 'secret' ? 'secrets' : 'keys'}/${r.name}` === resource,
  );
  const canonical =
    model?.applications
      .flatMap((a) => a.resources)
      .find((r) => `${r.kind}/${r.name}` === resource)?.envName ??
    chosen?.tags?.envName;
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
        path.includes('/resources/') &&
        catalogToken.current?.value
          ? { 'x-vault-catalog-token': catalogToken.current.value }
          : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      if (response.status === 409) setConflicted(true);
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
      const m = parseApplications(raw, connection),
        rows = parseInventory(items, 'local/inventory', connection);
      if (!current(id)) return;
      setModel(m);
      setInventory(rows.rows);
      setNext(rows.nextLink);
      setConflicted(false);
      setNotice('');
      markDirty(false);
      const fresh = m.applications.find((a) => a.name === selected);
      setSelected(fresh?.name ?? '');
      setDisplayName(fresh?.displayName ?? '');
      setDescription(fresh?.description ?? '');
      setCreateName('');
      setCreateLabel('');
      setResource('');
      setMapping('');
      setPolicy('latest');
      setPin('');
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
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
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
    area = path.includes('/resources/')
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
        setCreateName('');
        setCreateLabel('');
      }
      if (area === 'link') {
        setResource('');
        setMapping('');
        setPolicy('latest');
        setPin('');
      }
    } catch (e) {
      if (current(id) && !c.signal.aborted)
        setError(e instanceof Error ? e.message : 'Cannot save application.');
    } finally {
      if (catalogToken.current) catalogToken.current.value = '';
      if (current(id)) setBusy(false);
    }
  }
  function select(name: string) {
    const a = model?.applications.find((x) => x.name === name);
    setSelected(name);
    setDisplayName(a?.displayName ?? '');
    setDescription(a?.description ?? '');
    setResource('');
    setMapping('');
    setPolicy('latest');
    setPin('');
    markDirty(false);
  }
  async function more() {
    if (!next) return;
    const { c, id } = start();
    try {
      const path = continuationPath(next, 'local/inventory', connection);
      const rows = parseInventory(
        await read(path, c.signal),
        'local/inventory',
        connection,
      );
      if (current(id)) {
        setInventory((old) => [...old, ...rows.rows]);
        setNext(rows.nextLink);
      }
    } catch (e) {
      if (current(id) && !c.signal.aborted)
        setError(e instanceof Error ? e.message : 'Cannot load resources.');
    } finally {
      if (current(id)) setBusy(false);
    }
  }
  function choose(value: string) {
    setResource(value);
    const r = inventory.find(
      (r) => `${r.kind === 'secret' ? 'secrets' : 'keys'}/${r.name}` === value,
    );
    const linked = model?.applications
      .flatMap((a) => a.resources)
      .find((r) => `${r.kind}/${r.name}` === value);
    setMapping(linked?.envName ?? r?.tags?.envName ?? '');
    markDirty(true);
  }
  function editLink(r: ApplicationResource) {
    setResource(`${r.kind}/${r.name}`);
    setMapping(r.envName);
    setPolicy(r.policy === 'latest' ? 'latest' : 'pin');
    setPin(r.policy === 'latest' ? '' : r.policy);
    markDirty(true);
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
          <h2>Applications</h2>
          <p>
            Model applications and their resource links in{' '}
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
            <h2>Application model</h2>
            {!model.applications.length && (
              <p>No applications in this namespace.</p>
            )}
            <div className="application-list">
              {model.applications.map((a) => (
                <button
                  className={
                    'secondary-button ' +
                    (selected === a.name ? 'selected' : '')
                  }
                  key={a.name}
                  aria-pressed={selected === a.name}
                  disabled={busy}
                  onClick={() => guarded(() => select(a.name))}
                >
                  {a.displayName}
                </button>
              ))}
            </div>
            {isShared ? (
              <form
                onChange={() => markDirty(true, 'create')}
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(
                    'local/applications/' + encodeURIComponent(createName),
                    { displayName: createLabel, description: '' },
                    'PUT',
                    'create',
                  );
                }}
              >
                <h3>Create application</h3>
                <label>
                  Application name
                  <input
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
                <button
                  className="primary-button"
                  disabled={busy || conflicted}
                >
                  Create application
                </button>
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
              {isShared && app && (app.liveEnabled ? <p>Live configuration enabled. Check consumer reports for adoption.</p> : <details><summary>Use live configuration</summary><p>This explicitly switches updated consumers from startup configuration to these UI links. Saving a model alone does not switch them. Older consumers need the updated adapter. This switch cannot be reversed here; encryption-key changes still require safe migration.</p><p>Save or reload any unsaved edits before activating.</p><button className="primary-button" disabled={busy||conflicted||!app.supported||!app.resources.length} onClick={()=>{if(dirty.current){setError('Save or reload unsaved edits before activating.');return;}void mutate('local/applications/'+encodeURIComponent(selected)+'/activate',{},'PUT','activation');}}>Activate live configuration</button></details>)}
        <h3>Linked resources</h3>
              {!app?.resources.length && (
                <p>No resources linked in this namespace.</p>
              )}
              <div className="application-resources">
                {app?.resources.map((r) => (
                  <article
                    className="application-resource"
                    key={`${r.kind}/${r.name}`}
                  >
                    <h4>
                      {r.name}{' '}
                      <small>
                        {r.kind === 'secrets' ? 'Secret' : 'Key handle'}
                      </small>
                    </h4>
                    <dl>
                      <dt>ENV variable</dt>
                      <dd>
                        <code>{r.envName}</code>
                      </dd>
                      <dt>Version</dt>
                      <dd>
                        {r.policy === 'latest' ? 'Latest' : 'Pinned'} ·{' '}
                        <code>{r.version ?? 'Missing'}</code>
                      </dd>
                      <dt>Resource state</dt>
                      <dd>
                        {r.missing
                          ? 'Missing resource — update cannot apply'
                          : r.enabled
                            ? 'Enabled'
                            : 'Disabled — update cannot apply'}
                      </dd>
                    </dl>
                    {r.applications.filter((a) => a !== selected).length >
                      0 && (
                      <p>
                        Also used by:{' '}
                        {r.applications
                          .filter((a) => a !== selected)
                          .join(', ')}
                      </p>
                    )}
                    <details>
                      <summary>Tags and application links</summary>
                      <dl>
                        {Object.entries(r.tags).map(([k, v]) => (
                          <React.Fragment key={k}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                      <p>Applications: {r.applications.join(', ')}</p>
                    </details>
                    <button
                      className="secondary-button"
                      disabled={busy || conflicted}
                      onClick={() => guarded(() => editLink(r))}
                    >
                      Edit link {r.name}
                    </button>
                    <button
                      className="text-button"
                      disabled={busy || conflicted}
                      onClick={() =>
                        void mutate(
                          `local/applications/${encodeURIComponent(selected)}/resources/${r.kind}/${encodeURIComponent(r.name)}`,
                          {},
                          'DELETE',
                        )
                      }
                    >
                      Unlink {r.name}
                    </button>
                  </article>
                ))}
              </div>
              <form
                onChange={() => markDirty(true)}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (resource)
                    void mutate(
                      `local/applications/${encodeURIComponent(selected)}/resources/${resource.split('/').map(encodeURIComponent).join('/')}`,
                      {
                        envName: mapping,
                        version: policy === 'latest' ? 'latest' : pin,
                      },
                    );
                }}
              >
                <h3>Link an existing resource</h3>
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
                <label>
                  Existing resource
                  <select
                    required
                    value={resource}
                    onChange={(e) => choose(e.target.value)}
                  >
                    <option value="">Choose a secret or key</option>
                    {inventory.map((r) => (
                      <option
                        key={`${r.kind}/${r.name}`}
                        value={`${r.kind === 'secret' ? 'secrets' : 'keys'}/${r.name}`}
                      >
                        {r.name} ({r.kind})
                      </option>
                    ))}
                  </select>
                </label>
                {next && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void more()}
                  >
                    Load more resources
                  </button>
                )}
                <label>
                  ENV variable name
                  <input
                    value={mapping}
                    onChange={(e) => setMapping(e.target.value)}
                    readOnly={!!canonical}
                    required
                    pattern="[A-Z][A-Z0-9_]{0,127}"
                    maxLength={128}
                    placeholder="DATABASE_URL"
                  />
                </label>
                {canonical && (
                  <p>
                    This resource uses the same ENV name in every application:{' '}
                    <code>{canonical}</code>.
                  </p>
                )}
                {chosen?.kind === 'key' && (
                  <p>
                    Keys remain non-exportable handles. Linking never exports
                    private key material.
                  </p>
                )}
                <label>
                  Version policy
                  <select
                    value={policy}
                    onChange={(e) => setPolicy(e.target.value)}
                  >
                    <option value="latest">Latest (default)</option>
                    <option value="pin">Pin exact version (advanced)</option>
                  </select>
                </label>
                {policy === 'pin' && (
                  <label>
                    Immutable version
                    <input
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      pattern="[a-f0-9]{32}"
                      maxLength={32}
                      required
                    />
                  </label>
                )}
                <p>
                  Sharing reuses the existing resource. Unlinking does not
                  delete it.
                </p>
                <button
                  className="primary-button"
                  disabled={busy || conflicted || !resource}
                >
                  Link resource
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
