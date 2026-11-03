"use client";
import React, { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { DiscardDialog } from "./discard-dialog";
import { RuntimeAccessPanel } from "./runtime-access-panel";
import { parseRuntimeStatus } from "../lib/applications";
import {
  parseConfiguration,
  parseTenant,
  configurationReferences,
  exportConfiguration,
  type RuntimeConfigurationDocument,
  type SecretSelection,
  type TenantSelection,
  type KeyPlan,
} from "../lib/runtime-configuration";
type Connection = { environment: string; tenant: string; token: string };
function InheritedBindings({
  secrets,
  keySets = [],
}: {
  secrets: SecretSelection[];
  keySets?: KeyPlan[];
}) {
  return (
    <>
      {secrets.length ? (
        <table
          className="applications-catalog-table"
          aria-label="Inherited secret bindings"
        >
          <thead>
            <tr>
              <th>Purpose</th>
              <th>ENV mapping</th>
              <th>Version policy</th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((s, index) => (
              <tr key={index}>
                <td>
                  {s.displayName || (/^runtime-credential-[a-f0-9]{24}$/.test(s.purpose) ? "Integration credentials" : s.purpose)}
                  {(s.displayName || /^runtime-credential-[a-f0-9]{24}$/.test(s.purpose)) && (
                    <small className="runtime-credential-id">{s.purpose}</small>
                  )}
                </td>
                <td>
                  <code>{s.mapping}</code>
                </td>
                <td>
                  {s.version ?? "Canonical version resolved on publication"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No inherited secret bindings in this preview.</p>
      )}
      {keySets.map((key, index) => (
        <div key={index}>
          <h4>{key.reference}</h4>
          <p>
            Current wrapping label: <code>{key.currentWrappingVersion}</code>
          </p>
          <table
            className="applications-catalog-table"
            aria-label={"Inherited key roles for " + key.reference}
          >
            <thead>
              <tr>
                <th>Role</th>
                <th>ENV mapping</th>
                <th>Vault version / policy</th>
              </tr>
            </thead>
            <tbody>
              {key.wrappingVersions.map((w, n) => (
                <tr key={n}>
                  <td>Wrapping · {w.keyVersion}</td>
                  <td>{key.mappings?.wrapping ?? "Canonical mapping"}</td>
                  <td>{w.vaultVersion ?? "Canonical version"}</td>
                </tr>
              ))}
              <tr>
                <td>Index</td>
                <td>{key.mappings?.index ?? "Canonical mapping"}</td>
                <td>{key.indexVersion ?? "Canonical version"}</td>
              </tr>
              <tr>
                <td>Control</td>
                <td>{key.mappings?.control ?? "Canonical mapping"}</td>
                <td>{key.controlVersion ?? "Canonical version"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
export function RuntimeConfigurationPanel({
  connection,
  onDirty,
  onUnauthorized,
}: {
  connection: Connection;
  onDirty?: (value: boolean) => void;
  onUnauthorized?: () => void;
}) {
  const [configuration, setConfiguration] =
      useState<RuntimeConfigurationDocument>(),
    [availableApplications, setAvailableApplications] = useState<
      RuntimeConfigurationDocument["applications"]
    >({});
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({});
  const [selectedApps, setSelectedApps] = useState<string[]>([]),
    [revision, setRevision] = useState(0),
    [published, setPublished] = useState(false),
    [selectedTenant, setSelectedTenant] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [catalogError, setCatalogError] = useState("");
  const [importText, setImportText] = useState(""),
    [preview, setPreview] = useState<RuntimeConfigurationDocument>(),
    [exportText, setExportText] = useState(""),
    [pending, setPending] = useState<() => void>();
  const tenantInput = useRef<HTMLInputElement>(null),
    grantInput = useRef<HTMLInputElement>(null),
    credentials = useRef<Record<string, string>>({}),
    generations = useRef<Record<string, number>>({}),
    controller = useRef<AbortController | undefined>(undefined);
  const dirtyCallback = useRef(onDirty),
    unauthorized = useRef(onUnauthorized);
  dirtyCallback.current = onDirty;
  unauthorized.current = onUnauthorized;
  function mark(value: boolean) {
    setDirty(value);
    dirtyCallback.current?.(value);
    setExportText("");
    setNotice("");
  }
  function guarded(action: () => void) {
    if (dirty) setPending(() => action);
    else action();
  }
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    tenant = connection.tenant,
    token = connection.token,
  ) {
    const signal = controller.current?.signal;
    const response = await fetch("/api/vault/" + path, {
      method,
      headers: {
        "x-vault-token": token,
        "x-vault-environment": connection.environment,
        "x-vault-tenant": tenant,
        ...(method === "PUT" || method === "POST"
          ? { "x-vault-tenant-tokens": JSON.stringify(credentials.current) }
          : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!response.ok) {
      if (response.status === 401) unauthorized.current?.();
      if (response.status === 409) setConflict(true);
      throw Error(
        response.status === 409
          ? "Revision conflict. Reload configuration and review assignments before saving."
          : response.status === 403
            ? "The grant cannot access the selected namespace or canonical definitions."
            : "Configuration request failed. Check canonical Applications links, tenant definitions and permissions.",
      );
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error("Invalid configuration response.");
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  }
  async function perform(action: () => Promise<void>) {
    const owner = controller.current;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (controller.current === owner && !owner?.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Configuration request failed.",
        );
    } finally {
      if (controller.current === owner && !owner?.signal.aborted)
        setBusy(false);
    }
  }
  async function load() {
    await perform(async () => {
      const raw = await request("local/runtime-configuration");
      const next = parseConfiguration(
        raw.configuration,
        connection.environment,
        true,
      );
      const available =
        raw.availableApplications === undefined
          ? next.applications
          : parseConfiguration(
              {
                kind: "runtime-configuration",
                schemaVersion: 1,
                id: connection.environment,
                applications: raw.availableApplications,
                tenants: [],
              },
              connection.environment,
              true,
            ).applications;
      if (!Number.isSafeInteger(raw.revision) || raw.revision < 0)
        throw Error("Invalid configuration revision.");
      if (controller.current?.signal.aborted) return;
      setConfiguration(next);
      setAvailableApplications(available);
      setSelectedApps(Object.keys(next.applications));
      setRevision(raw.revision);
      setPublished(
        typeof raw.publicationId === "string" && raw.publicationId.length > 0,
      );
      setSelectedTenant("");
      setExpandedApps({});
      setConflict(false);
      credentials.current = {};
      generations.current = {};
      mark(false);
      setCatalogError(
        raw.availableApplications === undefined
          ? "Showing current references. Reload after the API update to select other catalog applications."
          : "",
      );
    });
  }

  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void load();
    const clear = () => {
      credentials.current = {};
      if (grantInput.current) grantInput.current.value = "";
    };
    window.addEventListener("pagehide", clear);
    return () => {
      c.abort();
      clear();
      dirtyCallback.current?.(false);
      window.removeEventListener("pagehide", clear);
    };
  }, [connection.environment, connection.tenant, connection.token]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function loadTenant(name: string, token: string) {
    if (!configuration) return;
    void perform(async () => {
      const raw = await request(
        "local/runtime-configuration/tenants/" +
          encodeURIComponent(name),
        "GET",
        undefined,
        name,
        token,
      );
      const loaded = parseTenant(
        {
          tenant: raw.tenant,
          applications: [],
          secrets: raw.secrets,
          keySets: raw.keySets,
        },
        true,
      );
      if (
        loaded.tenant !== name ||
        !Number.isSafeInteger(raw.generation) ||
        raw.generation < 0
      )
        throw Error("Invalid tenant canonical preview.");
      if (controller.current?.signal.aborted) return;
      credentials.current[name] = token;
      generations.current[name] = raw.generation;
      const existing = configuration.tenants.find(
        (t) => t.tenant === name,
      );
      setConfiguration({
        ...configuration,
        tenants: existing
          ? configuration.tenants.map((t) =>
              t.tenant === name
                ? { ...loaded, applications: existing.applications }
                : t,
            )
          : [...configuration.tenants, loaded],
      });
      if (!existing) mark(true);
      setSelectedTenant(name);
    });
  }
  const names = { ...availableApplications, ...configuration?.applications };
  const tenant = configuration?.tenants.find(
    (t) => t.tenant === selectedTenant,
  );
  function referenceDraft() {
    if (!configuration) throw Error("Load configuration first.");
    return configurationReferences({
      ...configuration,
      applications: Object.fromEntries(
        selectedApps.map((slug) => [slug, names[slug]]),
      ),
    });
  }
  function selectApp(slug: string, included: boolean) {
    setSelectedApps(
      included
        ? [...selectedApps, slug]
        : selectedApps.filter((s) => s !== slug),
    );
    if (!included && configuration)
      setConfiguration({
        ...configuration,
        tenants: configuration.tenants.map((t) => ({
          ...t,
          applications: t.applications.filter((a) => a !== slug),
        })),
      });
    mark(true);
  }
  function changeTenant(next: TenantSelection) {
    if (configuration) {
      setConfiguration({
        ...configuration,
        tenants: configuration.tenants.map((t) =>
          t.tenant === next.tenant ? next : t,
        ),
      });
      mark(true);
    }
  }
  return (
    <div className="applications-layout">
      {pending && (
        <DiscardDialog
          onStay={() => setPending(undefined)}
          onDiscard={() => {
            const action = pending;
            setPending(undefined);
            action();
          }}
        />
      )}
      <section className="panel applications-toolbar">
        <div>
          <h2>Runtime configuration</h2>
          <p>
            ID: <strong>{connection.environment}</strong>. Combine existing
            applications and tenants. Bindings are inherited; configuration Save
            never changes their definitions or grants access.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => guarded(() => void load())}
        >
          Reload configuration
        </button>
      </section>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Loading…</p>}
      {configuration && (
        <fieldset disabled={busy} className="runtime-configuration-editor">
          <section className="panel">
            <h2>Applications</h2>
            <p>Inherited from Applications</p>
            <p>
              Manage names, resource links, versions and ENV mappings in the
              Applications section. Runtime configuration selects existing
              application IDs only.
            </p>
            {catalogError && <p role="status">{catalogError}</p>}
            {Object.entries(names).map(([slug, a]) => (
              <div key={slug} className="runtime-app-row">
                <div className="runtime-app-header">
                  <label className="runtime-app-choice">
                    <input
                      type="checkbox"
                      aria-label={"Include " + a.displayName}
                      checked={selectedApps.includes(slug)}
                      onChange={(e) => selectApp(slug, e.target.checked)}
                    />
                    {a.displayName}
                  </label>
                  <button
                    type="button"
                    className="runtime-app-toggle"
                    aria-label={`${expandedApps[slug] ? "Collapse" : "Expand"} ${a.displayName} details`}
                    aria-expanded={!!expandedApps[slug]}
                    aria-controls={`app-details-${slug}`}
                    onClick={() => setExpandedApps((current) => ({...current,[slug]:!current[slug]}))}
                  >
                    {expandedApps[slug]
                      ? <ChevronUpIcon aria-hidden="true" />
                      : <ChevronDownIcon aria-hidden="true" />}
                  </button>
                </div>
                {expandedApps[slug] && (
                  <div id={`app-details-${slug}`}>
                    <p><code>{slug}</code> · {a.description}</p>
                    <InheritedBindings secrets={a.secrets} />
                  </div>
                )}
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Tenants</h2>
            <p>
              Select an existing tenant and its consuming applications.
              Canonical tenant definitions own the inherited secrets and key
              histories.
            </p>
            <details>
              <summary>Add tenant</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = tenantInput.current?.value ?? "",
                    token = grantInput.current?.value || connection.token;
                  if (grantInput.current) grantInput.current.value = "";
                  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || name === "_shared") {
                    setError("Enter an existing tenant slug.");
                    return;
                  }
                  loadTenant(name, token);
                }}
              >
                <label>
                  Existing tenant slug
                  <input
                    ref={tenantInput}
                    required
                    pattern="[A-Za-z0-9_-]{1,64}"
                  />
                </label>
                <label>
                  Tenant grant (optional)
                  <input
                    ref={grantInput}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button className="secondary-button" disabled={busy}>
                  Load tenant
                </button>
              </form>
            </details>
            <table className="applications-catalog-table runtime-tenants-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Assigned applications</th>
                  <th>Inherited bindings</th>
                  <th aria-label="Expand or collapse tenant" />
                </tr>
              </thead>
              <tbody>
                {configuration.tenants.map((t) => (
                  <tr key={t.tenant}>
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() => setSelectedTenant(selectedTenant === t.tenant ? "" : t.tenant)}
                      >
                        {t.tenant}
                      </button>
                      {selectedTenant === t.tenant && (
                        <form
                          className="runtime-tenant-load"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const input = e.currentTarget.elements.namedItem("grant") as HTMLInputElement;
                            const token = input.value || credentials.current[t.tenant] || connection.token;
                            input.value = "";
                            loadTenant(t.tenant, token);
                          }}
                        >
                          <label>
                            Grant
                            <input name="grant" aria-label={"Grant for " + t.tenant}
                              type="password" autoComplete="off" spellCheck={false} />
                          </label>
                          <button className="secondary-button" disabled={busy}>Load</button>
                        </form>
                      )}
                    </td>
                    <td>
                      {t.applications
                        .map((a) => names[a]?.displayName ?? a)
                        .join(", ") || "Unassigned"}
                    </td>
                    <td>
                      {t.secrets.length} secrets, {t.keySets.length} key sets
                    </td>
                    <td className="runtime-tenant-actions">
                      <button
                        type="button"
                        className="runtime-tenant-toggle"
                        aria-label={`${selectedTenant === t.tenant ? "Collapse" : "Expand"} ${t.tenant}`}
                        aria-expanded={selectedTenant === t.tenant}
                        aria-controls={`tenant-details-${t.tenant}`}
                        onClick={() => setSelectedTenant(selectedTenant === t.tenant ? "" : t.tenant)}
                      >
                        {selectedTenant === t.tenant
                          ? <ChevronUpIcon aria-hidden="true" />
                          : <ChevronDownIcon aria-hidden="true" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tenant && (
              <>
                <section id={`tenant-details-${tenant.tenant}`} aria-label={"Bindings for " + tenant.tenant}>
                  <h3>{tenant.tenant} assignments</h3>
                  <fieldset>
                    <legend>Assigned consumers</legend>
                    {selectedApps.filter((slug) => slug !== "vault-app").map((slug) => (
                      <label key={slug} className="runtime-app-choice">
                        <input
                          type="checkbox"
                          aria-label={`${names[slug]?.displayName ?? slug} consumes ${tenant.tenant}`}
                          checked={tenant.applications.includes(slug)}
                          onChange={(e) =>
                            changeTenant({
                              ...tenant,
                              applications: e.target.checked
                                ? [...tenant.applications, slug]
                                : tenant.applications.filter((s) => s !== slug),
                            })
                          }
                        />
                        {names[slug]?.displayName ?? slug}
                      </label>
                    ))}
                  </fieldset>
                  <p>Inherited from tenant canonical definitions</p>
                  <p>
                    Load this tenant with its existing grant to refresh the
                    read-only preview. Missing material must be provisioned in
                    the tenant namespace.
                  </p>
                  <InheritedBindings
                    secrets={tenant.secrets}
                    keySets={tenant.keySets}
                  />
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setConfiguration({
                        ...configuration,
                        tenants: configuration.tenants.filter(
                          (t) => t.tenant !== tenant.tenant,
                        ),
                      });
                      setSelectedTenant("");
                      delete credentials.current[tenant.tenant];
                      delete generations.current[tenant.tenant];
                      mark(true);
                    }}
                  >
                    Remove tenant assignment
                  </button>
                </section>
                <RuntimeAccessPanel
                  connection={connection}
                  tenant={tenant.tenant}
                  tenantToken={
                    credentials.current[tenant.tenant] ?? connection.token
                  }
                  applications={tenant.applications}
                  names={names}
                />
                <TenantRuntimeReports
                  connection={{
                    ...connection,
                    tenant: tenant.tenant,
                    token:
                      credentials.current[tenant.tenant] ?? connection.token,
                  }}
                  applications={tenant.applications}
                  names={names}
                  revision={revision}
                  published={published && !dirty}
                />
              </>
            )}
          </section>
          <section className="panel">
            <h2>Review and save</h2>
            <p role="status">
              {published
                ? "Published metadata — binding adoption is confirmed only by fresh reports."
                : "Not published — review these assignments and Save to publish inherited startup manifests."}
            </p>
            <p>
              {dirty
                ? "Unsaved assignment changes."
                : "No unsaved assignment changes."}{" "}
              Applications:{" "}
              {selectedApps
                .map((slug) => names[slug]?.displayName ?? slug)
                .join(", ")}
              .
            </p>
            <p>
              Save resolves current canonical definitions, even when assignments
              are unchanged. Missing resources, mapping conflicts and unsafe key
              changes are rejected. Provider connections and business routes may
              still be pending.
            </p>
            <button
              className="primary-button"
              disabled={busy || conflict}
              onClick={() =>
                void perform(async () => {
                  const refs = referenceDraft();
                  const raw = await request(
                    "local/runtime-configuration",
                    "PUT",
                    {
                      expectedRevision: revision,
                      configuration: refs,
                      expectedGenerations: Object.fromEntries(
                        Object.entries(generations.current).filter(([tenant]) =>
                          refs.tenants.some((t) => t.tenant === tenant),
                        ),
                      ),
                    },
                  );
                  const next = parseConfiguration(
                    raw.configuration,
                    connection.environment,
                    true,
                  );
                  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0)
                    throw Error("Invalid saved revision.");
                  setConfiguration(next);
                  setSelectedApps(Object.keys(next.applications));
                  setRevision(raw.revision);
                  setPublished(
                    typeof raw.publicationId === "string" &&
                      raw.publicationId.length > 0,
                  );
                  generations.current = {};
                  mark(false);
                  setNotice(
                    "Saved configuration. Check consumer reports for binding adoption.",
                  );
                })
              }
            >
              Save configuration
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                try {
                  setExportText(exportConfiguration(referenceDraft()));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Export configuration
            </button>
            {exportText && (
              <label>
                Metadata-only export
                <textarea readOnly rows={10} value={exportText} />
              </label>
            )}
            <label>
              Import configuration JSON
              <textarea
                rows={5}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              disabled={busy || !importText}
              onClick={() =>
                void perform(async () => {
                  let input: unknown;
                  try {
                    input = JSON.parse(importText);
                  } catch {
                    throw Error(
                      "Import must contain valid metadata-only JSON.",
                    );
                  }
                  const raw = await request(
                    "local/runtime-configuration/import",
                    "POST",
                    input,
                  );
                  setPreview(
                    parseConfiguration(
                      raw.configuration,
                      connection.environment,
                      true,
                    ),
                  );
                })
              }
            >
              Preview import
            </button>
            {preview && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Review imported configuration"
                className="azure-confirm"
              >
                <h3>Review imported configuration</h3>
                <p>
                  Import uses assignments only. Names, secret versions, ENV
                  mappings and key sets always come from canonical definitions;
                  imported copies never overwrite them.
                </p>
                <pre>{exportConfiguration(preview)}</pre>
                <button
                  className="primary-button"
                  onClick={() => {
                    setConfiguration(preview);
                    setSelectedApps(Object.keys(preview.applications));
                    setPreview(undefined);
                    setSelectedTenant("");
                    setImportText("");
                    mark(true);
                  }}
                >
                  Use imported draft
                </button>
                <button
                  autoFocus
                  className="secondary-button"
                  onClick={() => setPreview(undefined)}
                >
                  Cancel import
                </button>
              </div>
            )}
          </section>
        </fieldset>
      )}
    </div>
  );
}
function TenantRuntimeReports({
  connection,
  applications,
  names,
  revision,
  published,
}: {
  connection: Connection;
  applications: string[];
  names: RuntimeConfigurationDocument["applications"];
  revision: number;
  published: boolean;
}) {
  const [reports, setReports] = useState<Record<string, string>>({});
  const appKey = applications.join(",");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setReports({});
    async function poll() {
      const entries = await Promise.all(
        appKey
          .split(",")
          .filter(Boolean)
          .map(async (slug) => {
            try {
              const response = await fetch(
                "/api/vault/local/applications/" +
                  encodeURIComponent(slug) +
                  "/status",
                {
                  headers: {
                    "x-vault-token": connection.token,
                    "x-vault-environment": connection.environment,
                    "x-vault-tenant": connection.tenant,
                  },
                  signal: controller.signal,
                  cache: "no-store",
                },
              );
              if (!response.ok) throw Error();
              const status = parseRuntimeStatus(await response.json());
              const fresh = status.instances.filter(
                (i) => i.expiresAt > Date.now(),
              );
              const label =
                status.state === "applied" &&
                fresh.some((i) => i.status === "applied")
                  ? "Bindings adopted (consumer reported)"
                  : status.state === "updating"
                    ? "Loading (consumer reported)"
                    : ["blocked", "warning"].includes(status.state)
                      ? "Error (consumer reported)"
                      : "Pending — no fresh adoption report";
              return [slug, label];
            } catch {
              return [slug, "Pending — runtime reports unavailable"];
            }
          }),
      );
      if (active) setReports(Object.fromEntries(entries));
    }
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [
    connection.environment,
    connection.tenant,
    connection.token,
    appKey,
    revision,
  ]);
  return (
    <section aria-label="Tenant runtime reports">
      <h3>Tenant runtime reports</h3>
      <p>
        This reports Vault binding adoption only. Tenant provisioning, provider
        connections and business route readiness may still be pending. Consumer
        reports are observations, not independent attestations.
      </p>
      {applications.map((slug) => (
        <p role="status" key={slug}>
          {names[slug]?.displayName ?? slug}:{" "}
          {!published
            ? "Pending — configuration not published"
            : (reports[slug] ?? "Pending — waiting for consumer reports")}
        </p>
      ))}
    </section>
  );
}
