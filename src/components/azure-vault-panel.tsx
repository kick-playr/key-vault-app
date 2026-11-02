import { SecretVersionValue } from "./secret-version-value";
import { DiscardDialog } from "./discard-dialog";
import React, { useEffect, useRef, useState } from "react";
import {
  parseInventory,
  continuationPath,
  type InventoryRow,
} from "../lib/inventory";
import { parseVersions, type VaultVersion } from "../lib/azure-vault";
import {
  AzureVaultForm,
  type AzureMode,
  type VaultRequest,
} from "./azure-vault-form";
interface Props {
  kind: "keys" | "secrets";
  connection: { environment: string; tenant: string; token: string };
  onMutation: () => void;
  onDirty: (dirty: boolean) => void;
  onUnauthorized: () => void;
}
const date = (n?: number) => {
  if (n === undefined) return "Not set";
  if (n > 253402300799)
    return `${n} epoch seconds (outside the date control range)`;
  return new Date(n * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
};
function lifecycle(v: VaultVersion) {
  const now = Date.now() / 1000;
  return !v.attributes.enabled
    ? "Disabled"
    : v.attributes.nbf !== undefined && v.attributes.nbf > now
      ? "Not yet active"
      : v.attributes.exp !== undefined && v.attributes.exp <= now
        ? "Expired"
        : "Enabled";
}
export function AzureVaultPanel({
  kind,
  connection,
  onMutation,
  onDirty,
  onUnauthorized,
}: Props) {
  const [rows, setRows] = useState<InventoryRow[]>([]),
    [next, setNext] = useState<string>();
  const [search, setSearch] = useState(""),
    [nameInput, setNameInput] = useState(""),
    [name, setName] = useState("");
  const [history, setHistory] = useState<VaultVersion[]>([]),
    [selected, setSelected] = useState<VaultVersion>();
  const [mode, setMode] = useState<AzureMode>(),
    [formEpoch, setFormEpoch] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [searchPending, setSearchPending] = useState(false);
  const [pending, setPending] = useState<() => void>();
  const dirty = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const previousSearch = useRef(search);
  const heading = useRef<HTMLHeadingElement>(null),
    alert = useRef<HTMLParagraphElement>(null);
  function markDirty(value: boolean) {
    dirty.current = value;
    onDirty(value);
  }
  function begin() {
    setSearchPending(false);
    controller.current?.abort();
    controller.current = new AbortController();
    epoch.current++;
    setBusy(true);
    setError("");
    return { id: epoch.current, signal: controller.current.signal };
  }
  type Task = ReturnType<typeof begin>;
  function current(task: Task) {
    return mounted.current && task.id === epoch.current && !task.signal.aborted;
  }
  async function request(task: Task, path: string, init: RequestInit = {}) {
    const response = await fetch("/api/vault/" + path, {
      ...init,
      headers: {
        "x-vault-token": connection.token,
        "x-vault-environment": connection.environment,
        "x-vault-tenant": connection.tenant,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.any([task.signal, AbortSignal.timeout(8000)]),
    });
    if (!current(task)) throw Error("Cancelled");
    if (!response.ok) {
      if (response.status === 401) onUnauthorized();
      if (init.method && [502, 503, 504].includes(response.status))
        throw Error(
          "The write outcome is unknown. Refresh and check version history before submitting again.",
        );
      if (response.status === 403)
        throw Error(
          "Permission denied for this namespace or operation. Lists need list permission; history needs read; saving needs write.",
        );
      if ([400, 409].includes(response.status) && path.includes("inventory"))
        throw Error(
          "Inventory changed or the continuation expired. Refresh to restart from the first page.",
        );
      if (response.status === 404)
        throw Error("Resource or version not found in this namespace.");
      throw Error(
        "Vault request failed. Check your connection and permissions.",
      );
    }
    const data: unknown = await response.json();
    if (!current(task)) throw Error("Cancelled");
    return data;
  }
  function failed(task: Task, e: unknown, writing = false) {
    if (current(task)) {
      setError(
        writing &&
          (!(e instanceof Error) ||
            e.name === "TimeoutError" ||
            e instanceof TypeError)
          ? "The write outcome is unknown. Refresh and check version history before submitting again."
          : e instanceof Error
            ? e.message
            : "Vault request failed.",
      );
      queueMicrotask(() => alert.current?.focus());
    }
  }
  function finish(task: Task) {
    if (current(task)) setBusy(false);
  }
  function inventoryPath() {
    const q = new URLSearchParams({
      kind: kind === "keys" ? "key" : "secret",
      maxresults: "25",
    });
    if (search.length >= 3) q.set("search", search);
    return "local/inventory?" + q;
  }
  async function inventory(task: Task, path = inventoryPath(), append = false) {
    const data = await request(task, path);
    const page = parseInventory(data, "local/inventory", connection);
    if (
      page.rows.some((row) => row.kind !== (kind === "keys" ? "key" : "secret"))
    )
      throw Error("Invalid inventory kind.");
    if (current(task)) {
      setRows((prev) => (append ? [...prev, ...page.rows] : page.rows));
      setNext(page.nextLink);
    }
  }
  async function refreshList(path?: string, append = false) {
    if (!path && search.length > 0 && search.length < 3) return;
    const task = begin();
    try {
      await inventory(task, path, append);
    } catch (e) {
      failed(task, e);
    } finally {
      finish(task);
    }
  }
  async function loadHistory(resource: string, edit = false) {
    const task = begin();
    setNotice("");
    try {
      if (!/^[A-Za-z0-9-]{1,127}$/.test(resource))
        throw Error("Name must contain 1–127 letters, digits or hyphens.");
      const data = await request(task, `${kind}/${resource}/versions`);
      const versions = parseVersions(data, kind, connection, resource);
      if (current(task)) {
        const exact = edit
          ? versions.find((v) => v.version === selected?.version)
          : versions.at(-1);
        if (edit && !exact)
          throw Error("Selected version no longer exists. Refresh history.");
        setName(resource);
        setHistory(versions);
        setSelected(exact);
        markDirty(false);
        setMode(edit ? "edit-metadata" : undefined);
        setFormEpoch((v) => v + 1);
        queueMicrotask(() => heading.current?.focus());
      }
    } catch (e) {
      failed(task, e);
    } finally {
      finish(task);
    }
  }
  function leave(action: () => void) {
    if (dirty.current) {
      setPending(() => action);
    } else action();
  }
  function cancelRead() {
    setSearchPending(false);
    controller.current?.abort();
    epoch.current++;
    setBusy(false);
  }
  function showForm(nextMode: AzureMode) {
    leave(() => {
      cancelRead();
      markDirty(false);
      setNotice("");
      setError("");
      setMode(nextMode);
      setFormEpoch((v) => v + 1);
      queueMicrotask(() => heading.current?.focus());
    });
  }
  async function submit(operation: VaultRequest): Promise<boolean> {
    const task = begin();
    setNotice("");
    try {
      const response = await request(task, operation.path, {
        method: operation.method,
        body: JSON.stringify(operation.body),
      });
      // Project only the version identifier; never put the echoed secret or JWK in React state.
      const raw = response as { id?: unknown; key?: { kid?: unknown } };
      const identifier = kind === "secrets" ? raw?.id : raw?.key?.kid;
      const resource = operation.path.split("/")[1]!;
      const created =
        typeof identifier === "string"
          ? parseVersions(
              {
                value: [
                  {
                    [kind === "keys" ? "kid" : "id"]: identifier,
                    attributes: { enabled: true },
                  },
                ],
              },
              kind,
              connection,
              resource,
            )[0]?.version
          : undefined;
      if (!created)
        throw Error(
          "The write outcome is unknown. Refresh and check version history before submitting again.",
        );
      if (!current(task)) return false;
      markDirty(false);
      setMode(undefined);
      setName(resource);
      setNotice(`Saved to vault · version ${created}.`);
      onMutation();
      // Follow-up metadata errors must not relabel a successful write as a failed write.
      try {
        const data = await request(task, `${kind}/${resource}/versions`);
        const versions = parseVersions(data, kind, connection, resource);
        if (current(task)) {
          setHistory(versions);
          setSelected(versions.at(-1));
        }
      } catch (e) {
        failed(task, e);
      }
      try {
        await inventory(task);
      } catch (e) {
        failed(task, e);
      }
      queueMicrotask(() => heading.current?.focus());
      return true;
    } catch (e) {
      failed(task, e, true);
      return false;
    } finally {
      finish(task);
    }
  }
  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    void refreshList();
    return () => {
      mounted.current = false;
      epoch.current++;
      controller.current?.abort();
      onDirty(false);
    };
  }, [connection, kind]); // Connection identity changes only on authenticated connect.
  useEffect(() => {
    if (previousSearch.current === search) return;
    previousSearch.current = search;
    if (mode || (search.length > 0 && search.length < 3)) return;
    const scheduled = epoch.current;
    const timer = setTimeout(() => {
      if (mounted.current && scheduled === epoch.current) void refreshList();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, mode]);
  return (
    <section
      className="panel azure-panel"
      aria-label={`${kind === "keys" ? "Keys" : "Secrets"} Azure-style workspace`}
    >
      {name && (
        <p className="muted azure-breadcrumb">
          Vault / {kind === "keys" ? "Keys" : "Secrets"} / {name}
          {selected ? ` / ${selected.version}` : ""}
        </p>
      )}
      <h2
        ref={heading}
        tabIndex={-1}
        className={name && !mode ? undefined : "sr-only"}
      >
        {mode
          ? mode === "edit-metadata"
            ? "Edit metadata"
            : mode === "new-version"
              ? "New version"
              : kind === "keys"
                ? "Generate key"
                : "Generate/Import"
          : selected?.tags?.purpose ||
            name ||
            (kind === "keys" ? "Encryption keys" : "Secrets")}
      </h2>
      {notice && (
        <p role="status" className="azure-success">
          {notice}
        </p>
      )}
      {error && (
        <p ref={alert} role="alert" tabIndex={-1} className="error">
          {error}
        </p>
      )}
      <p role="status" className="sr-only">
        {busy ? "Loading…" : searchPending ? "Searching…" : ""}
      </p>
      {pending && (
        <DiscardDialog
          onStay={() => setPending(undefined)}
          onDiscard={() => {
            const action = pending;
            setPending(undefined);
            markDirty(false);
            action();
          }}
        />
      )}
      {mode ? (
        <AzureVaultForm
          key={formEpoch}
          mode={mode}
          name={mode === "create-secret" || mode === "create-key" ? "" : name}
          selected={
            mode === "new-version" || mode === "edit-metadata"
              ? selected
              : undefined
          }
          onSubmit={submit}
          onDirty={markDirty}
          valuePanel={
            selected && (
              <SecretVersionValue
                key={`${name}/${selected.version}/${epoch.current}`}
                connection={connection}
                name={name}
                version={selected.version}
                onUnauthorized={onUnauthorized}
              />
            )
          }
          onCancel={() =>
            leave(() => {
              markDirty(false);
              setMode(undefined);
            })
          }
        />
      ) : (
        <>
          <div className="azure-resource-toolbar">
            <form
              className="azure-search"
              onSubmit={(e) => {
                e.preventDefault();
                setNext(undefined);
                void refreshList();
              }}
            >
              <label className="azure-search-field">
                <span className="sr-only">Search by name or purpose</span>
                <input
                  type="search"
                  placeholder="Search name or purpose…"
                  value={search}
                  maxLength={512}
                  onChange={(e) => {
                    controller.current?.abort();
                    epoch.current++;
                    setBusy(false);
                    setSearch(e.target.value);
                    setSearchPending(
                      e.target.value.length === 0 || e.target.value.length >= 3,
                    );
                    setNext(undefined);
                  }}
                />
              </label>
              <button
                disabled={busy || (search.length > 0 && search.length < 3)}
              >
                Search
              </button>
            </form>

            <button
              onClick={() =>
                showForm(kind === "keys" ? "create-key" : "create-secret")
              }
            >
              {kind === "keys" ? "Generate key" : "Generate/Import"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setNext(undefined);
                void refreshList();
              }}
            >
              Refresh list
            </button>
            {name && (
              <>
                <button disabled={busy} onClick={() => void loadHistory(name)}>
                  Refresh versions
                </button>
                {kind === "secrets" && (
                  <button
                    disabled={busy || !selected}
                    onClick={() => showForm("new-version")}
                  >
                    New version
                  </button>
                )}
                <button
                  onClick={() => {
                    cancelRead();
                    setName("");
                    setHistory([]);
                    setSelected(undefined);
                  }}
                >
                  Back to list
                </button>
              </>
            )}
            <details className="azure-open-by-name">
              <summary title="Open by name">
                <span aria-hidden="true">…</span>
                <span className="sr-only">Open by name…</span>
              </summary>
              <form
                className="azure-open-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadHistory(nameInput);
                }}
              >
                <label className="field">
                  Open by name
                  <input
                    value={nameInput}
                    required
                    maxLength={127}
                    pattern="[A-Za-z0-9-]{1,127}"
                    onChange={(e) => setNameInput(e.target.value)}
                  />
                </label>
                <button disabled={busy}>Open versions</button>
              </form>
            </details>
          </div>
          {search.length > 0 && search.length < 3 && (
            <p className="muted">
              Type at least 3 characters to search by name or purpose.
            </p>
          )}
          {history.length > 0 && (
            <div className="azure-history">
              <h3>CURRENT VERSION</h3>
              {renderVersion(history.at(-1)!)}
              {history.length > 1 && (
                <>
                  <h3>OLDER VERSIONS</h3>
                  {history.slice(0, -1).reverse().map(renderVersion)}
                </>
              )}
              {selected && (
                <section className="azure-version-details">
                  <h3>Selected version {selected.version}</h3>
                  <dl>
                    <dt>Status</dt>
                    <dd>{lifecycle(selected)}</dd>
                    <dt>Created</dt>
                    <dd>{date(selected.attributes.created)}</dd>
                    <dt>Updated</dt>
                    <dd>{date(selected.attributes.updated)}</dd>
                    <dt>Activation</dt>
                    <dd>{date(selected.attributes.nbf)}</dd>
                    <dt>Expiration</dt>
                    <dd>{date(selected.attributes.exp)}</dd>
                    {selected.contentType !== undefined && (
                      <>
                        <dt>Content type</dt>
                        <dd>{selected.contentType || "Not set"}</dd>
                      </>
                    )}
                  </dl>
                  {selected.tags && (
                    <dl>
                      {Object.entries(selected.tags).map(([k, v]) => (
                        <React.Fragment key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  )}
                  {kind === "secrets" && (
                    <SecretVersionValue
                      key={`${name}/${selected.version}/${epoch.current}`}
                      connection={connection}
                      name={name}
                      version={selected.version}
                      onUnauthorized={onUnauthorized}
                    />
                  )}
                  {kind === "secrets" && (
                    <button
                      disabled={busy}
                      onClick={() => void loadHistory(name, true)}
                    >
                      Edit metadata
                    </button>
                  )}
                </section>
              )}
            </div>
          )}
          {!busy &&
            !searchPending &&
            !rows.length &&
            !(search.length > 0 && search.length < 3) && (
              <p className="muted">
                {search
                  ? "No matching resources."
                  : "No resources loaded. Create one, refresh, or open by name if list permission is unavailable."}
              </p>
            )}
          {!!rows.length && (
            <table className="azure-table">
              <caption className="sr-only">Latest resource metadata</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  {kind === "secrets" && <th>Versions</th>}
                  <th>Status</th>
                  <th>Updated (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td data-label="Name">
                      <button onClick={() => void loadHistory(row.name)}>
                        {row.purpose || row.name}
                      </button>
                      {row.purpose && row.purpose !== row.name && (
                        <small className="muted azure-resource-id">
                          {row.name}
                        </small>
                      )}
                    </td>
                    {kind === "secrets" && (
                      <td data-label="Versions">{row.versionCount ?? "—"}</td>
                    )}
                    <td data-label="Status">
                      {lifecycle({
                        version: row.version,
                        attributes: {
                          enabled: row.enabled,
                          exp: row.expires,
                          nbf: row.activation,
                        },
                      })}
                    </td>
                    <td data-label="Updated">{date(row.updated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {next && (
            <button
              disabled={busy}
              onClick={() => {
                try {
                  void refreshList(
                    continuationPath(next, "local/inventory", connection),
                    true,
                  );
                } catch {
                  setNext(undefined);
                  setError("Invalid continuation. Refresh the list.");
                }
              }}
            >
              Next page
            </button>
          )}
        </>
      )}
    </section>
  );
  function renderVersion(version: VaultVersion) {
    return (
      <div className="azure-version-row" key={version.version}>
        <button
          aria-pressed={selected?.version === version.version}
          onClick={() => setSelected(version)}
          aria-label={`Version ${version.version}`}
        >
          {version.version}
        </button>
        <span>{lifecycle(version)}</span>
        <span>{date(version.attributes.created)}</span>
      </div>
    );
  }
}
