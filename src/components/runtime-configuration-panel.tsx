"use client";
import React, { useEffect, useRef, useState } from "react";
import { parseRuntimeStatus } from "../lib/applications";
import { DiscardDialog } from "./discard-dialog";
import { RuntimeAccessPanel } from "./runtime-access-panel";
import { ApplicationsPanel } from "./applications-panel";
import {
  parseConfiguration,
  parseTenant,
  parseKeySets,
  exportConfiguration,
  type RuntimeConfigurationDocument,
  type SecretSelection,
  type TenantSelection,
  type KeyPlan,
} from "../lib/runtime-configuration";
type Connection = { environment: string; tenant: string; token: string };
function SecretBindings({
  secrets,
  onChange,
}: {
  secrets: SecretSelection[];
  onChange: (s: SecretSelection[]) => void;
}) {
  return (
    <>
      {secrets.map((s, i) => (
        <fieldset key={i}>
          <legend>{s.purpose}</legend>
          <label>
            Purpose
            <input
              value={s.purpose}
              onChange={(e) =>
                onChange(
                  secrets.map((v, n) =>
                    n === i ? { ...v, purpose: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            ENV mapping
            <input
              value={s.mapping}
              onChange={(e) =>
                onChange(
                  secrets.map((v, n) =>
                    n === i ? { ...v, mapping: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Version (latest or immutable pin)
            <input
              value={s.version ?? ""}
              placeholder="Choose version — unresolved legacy selection"
              onChange={(e) =>
                onChange(
                  secrets.map((v, n) =>
                    n === i ? { ...v, version: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange(secrets.filter((_, n) => n !== i))}
          >
            Remove {s.purpose}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary-button"
        onClick={() =>
          onChange([
            ...secrets,
            { purpose: "", mapping: "", version: "latest" },
          ])
        }
      >
        Add secret binding
      </button>
    </>
  );
}
export function RuntimeConfigurationPanel({
  connection,
  onDirty,
  onUnauthorized,
}: {
  connection: Connection;
  onDirty?: (v: boolean) => void;
  onUnauthorized?: () => void;
}) {
  const [configuration, setConfiguration] =
    useState<RuntimeConfigurationDocument>();
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false);
  const [selected, setSelected] = useState(""),
    [importText, setImportText] = useState(""),
    [preview, setPreview] = useState<RuntimeConfigurationDocument>(),
    [exportText, setExportText] = useState(""),
    [pending, setPending] = useState<() => void>();
  const tenantInput = useRef<HTMLInputElement>(null),
    grantInput = useRef<HTMLInputElement>(null),
    credentials = useRef<Record<string, string>>({}),
    generations = useRef<Record<string, number>>({}),
    controller = useRef<AbortController | undefined>(undefined);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const catalogDirty = useRef(false);
  const dirtyCallback = useRef(onDirty),
    unauthorized = useRef(onUnauthorized);
  dirtyCallback.current = onDirty;
  unauthorized.current = onUnauthorized;
  function mark(value: boolean) {
    setDirty(value);
    dirtyCallback.current?.(value || catalogDirty.current);
    setExportText("");
  }
  function edit(next: RuntimeConfigurationDocument) {
    setConfiguration(next);
    mark(true);
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
    const response = await fetch(
      "/api/vault/local/runtime-configuration" + path,
      {
        method,
        headers: {
          "x-vault-environment": connection.environment,
          "x-vault-tenant": tenant,
          "x-vault-token": token,
          ...(method === "PUT" || (method === "POST" && path === "/import")
            ? { "x-vault-tenant-tokens": JSON.stringify(credentials.current) }
            : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!response.ok) {
      if (response.status === 401) unauthorized.current?.();
      if (response.status === 409) setConflict(true);
      throw Error(
        response.status === 409
          ? "Revision conflict. Reload configuration and review your changes before saving."
          : response.status === 403
            ? "The grant cannot access the selected namespace or resources."
            : "Configuration request failed. Check permissions, bindings and versions; reload before retrying a write.",
      );
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw Error("Invalid configuration response.");
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result as Record<string, any>;
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
      const raw = await request("");
      const next = parseConfiguration(
        raw.configuration,
        connection.environment,
      );
      if (!Number.isSafeInteger(raw.revision) || raw.revision < 0)
        throw Error("Invalid configuration revision.");
      if (controller.current?.signal.aborted) return;
      setConfiguration(next);
      setRevision(raw.revision);
      setPublished(
        typeof raw.publicationId === "string" && raw.publicationId.length > 0,
      );
      setConflict(false);
      setSelected("");
      credentials.current = {};
      generations.current = {};
      mark(false);
      setNotice("");
    });
  }
  useEffect(() => {
    controller.current = new AbortController();
    void load();
    const clear = () => {
      credentials.current = {};
      if (grantInput.current) grantInput.current.value = "";
    };
    window.addEventListener("pagehide", clear);
    return () => {
      controller.current?.abort();
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
  const tenant = configuration?.tenants.find((t) => t.tenant === selected);
  function changeTenant(next: TenantSelection) {
    if (configuration)
      edit({
        ...configuration,
        tenants: configuration.tenants.map((t) =>
          t.tenant === next.tenant ? next : t,
        ),
      });
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
            ID: <strong>{connection.environment}</strong>. Save publishes
            metadata and startup manifests. Grants and live activation are
            managed separately.
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
            <h2>Applications and shared bindings</h2>
            {Object.entries(configuration.applications).map(([slug, a]) => (
              <details key={slug}>
                <summary>{a.displayName}</summary>
                <p>
                  <code>{slug}</code> · {a.description}
                </p>
                <SecretBindings
                  secrets={a.secrets}
                  onChange={(secrets) =>
                    edit({
                      ...configuration,
                      applications: {
                        ...configuration.applications,
                        [slug]: { ...a, secrets },
                      },
                    })
                  }
                />
              </details>
            ))}
          </section>
          <section className="panel">
            <h2>Tenants</h2>
            <p>
              Load an existing tenant with its existing grant. Assignment does
              not grant runtime access or provision an organization.
            </p>
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
                void perform(async () => {
                  const raw = await request(
                    "/tenants/" + encodeURIComponent(name),
                    "GET",
                    undefined,
                    name,
                    token,
                  );
                  const loaded = parseTenant({
                    tenant: raw.tenant,
                    applications: [],
                    secrets: raw.secrets,
                    keySets: raw.keySets,
                  });
                  if (
                    loaded.tenant !== name ||
                    !Number.isSafeInteger(raw.generation) ||
                    raw.generation < 0
                  )
                    throw Error("Invalid tenant template.");
                  if (controller.current?.signal.aborted) return;
                  credentials.current[name] = token;
                  generations.current[name] = raw.generation;
                  const existing = configuration.tenants.find(
                    (t) => t.tenant === name,
                  );
                  if (!existing)
                    edit({
                      ...configuration,
                      tenants: [...configuration.tenants, loaded],
                    });
                  else if (!existing.secrets.length && !existing.keySets.length)
                    edit({
                      ...configuration,
                      tenants: configuration.tenants.map((t) =>
                        t.tenant === name
                          ? { ...loaded, applications: existing.applications }
                          : t,
                      ),
                    });
                  setSelected(name);
                });
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
              <button disabled={busy} className="secondary-button">
                Load tenant
              </button>
            </form>
            <table className="applications-catalog-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Consumers</th>
                  <th>Bindings</th>
                  <th>Key roles</th>
                </tr>
              </thead>
              <tbody>
                {configuration.tenants.map((t) => (
                  <tr key={t.tenant}>
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() => setSelected(t.tenant)}
                      >
                        {t.tenant}
                      </button>
                    </td>
                    <td>
                      {t.applications
                        .map(
                          (a) =>
                            configuration.applications[a]?.displayName ?? a,
                        )
                        .join(", ") || "Unassigned"}
                    </td>
                    <td>
                      {t.secrets.length} secrets, {t.keySets.length} key sets
                    </td>
                    <td>
                      {t.keySets.length &&
                      t.keySets.every(
                        (k) =>
                          k.mappings &&
                          k.wrappingVersions.some(
                            (w) => w.keyVersion === k.currentWrappingVersion,
                          ),
                      )
                        ? "Complete roles; save validates resources"
                        : "Incomplete / no key set"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tenant && (
              <>
                <TenantBindings
                  key={tenant.tenant}
                  tenant={tenant}
                  configuration={configuration}
                  onChange={changeTenant}
                />
                <RuntimeAccessPanel
                  connection={connection}
                  tenant={tenant.tenant}
                  tenantToken={
                    credentials.current[tenant.tenant] ?? connection.token
                  }
                  applications={tenant.applications}
                  names={configuration.applications}
                />
                <TenantRuntimeReports
                  connection={{
                    ...connection,
                    tenant: tenant.tenant,
                    token:
                      credentials.current[tenant.tenant] ?? connection.token,
                  }}
                  applications={tenant.applications}
                  names={configuration.applications}
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
                ? "Published metadata — consumer adoption is confirmed only by fresh reports."
                : "Not published — review this metadata draft and Save to publish startup manifests."}
            </p>
            <p>
              {dirty
                ? "Unsaved metadata changes."
                : "No unsaved metadata changes."}{" "}
              Affected consumers:{" "}
              {Object.values(configuration.applications)
                .map((a) => a.displayName)
                .join(", ")}
              .
            </p>
            <p>
              Tenant adoption is pending until authenticated consumer reports
              confirm it. Check application reports below. Business tenant
              provisioning and separately authorized runtime identities are
              required.
            </p>
            <button
              className="primary-button"
              disabled={busy || conflict || !dirty}
              onClick={() =>
                void perform(async () => {
                  const clean = parseConfiguration(
                    configuration,
                    connection.environment,
                    true,
                  );
                  const raw = await request("", "PUT", {
                    expectedRevision: revision,
                    configuration: clean,
                    expectedGenerations: Object.fromEntries(
                      Object.entries(generations.current).filter(([tenant]) =>
                        clean.tenants.some((t) => t.tenant === tenant),
                      ),
                    ),
                  });
                  const next = parseConfiguration(
                    raw.configuration,
                    connection.environment,
                  );
                  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0)
                    throw Error("Invalid saved revision.");
                  if (controller.current?.signal.aborted) return;
                  setConfiguration(next);
                  setRevision(raw.revision);
                  setPublished(
                    typeof raw.publicationId === "string" &&
                      raw.publicationId.length > 0,
                  );
                  generations.current = {};
                  mark(false);
                  setNotice(
                    "Saved configuration. Check consumer reports for runtime adoption.",
                  );
                })
              }
            >
              Save configuration
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                try {
                  setExportText(exportConfiguration(configuration));
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
                <textarea readOnly rows={12} value={exportText} />
              </label>
            )}
            <label>
              Import configuration JSON
              <textarea
                rows={6}
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
                  const raw = await request("/import", "POST", input);
                  if (!controller.current?.signal.aborted)
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
                  This replaces the draft. Review all mappings, Latest policies,
                  immutable pins and wrapping history before Save. No
                  permissions change.
                </p>
                <pre>{JSON.stringify(preview, null, 2)}</pre>
                <button
                  className="primary-button"
                  onClick={() => {
                    edit(preview);
                    setPreview(undefined);
                    setImportText("");
                    setSelected("");
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
      <details onToggle={(e) => setCatalogOpen(e.currentTarget.open)}>
        <summary>Application catalog and runtime reports</summary>
        {catalogOpen && (
          <ApplicationsPanel
            connection={connection}
            onDirty={(value) => {
              catalogDirty.current = value;
              dirtyCallback.current?.(dirty || value);
            }}
            onUnauthorized={onUnauthorized}
          />
        )}
      </details>
    </div>
  );
}
function TenantBindings({
  tenant,
  configuration,
  onChange,
}: {
  tenant: TenantSelection;
  configuration: RuntimeConfigurationDocument;
  onChange: (t: TenantSelection) => void;
}) {
  function updateKey(index: number, next: KeyPlan) {
    onChange({
      ...tenant,
      keySets: tenant.keySets.map((key, n) => (n === index ? next : key)),
    });
  }
  return (
    <section aria-label={"Bindings for " + tenant.tenant}>
      <h3>{tenant.tenant} bindings</h3>
      <fieldset>
        <legend>Assigned consumers</legend>
        {Object.entries(configuration.applications).map(([slug, a]) => (
          <label key={slug}>
            <input
              type="checkbox"
              aria-label={`${a.displayName} consumes ${tenant.tenant}`}
              checked={tenant.applications.includes(slug)}
              onChange={(e) =>
                onChange({
                  ...tenant,
                  applications: e.target.checked
                    ? [...tenant.applications, slug]
                    : tenant.applications.filter((s) => s !== slug),
                })
              }
            />
            {a.displayName}
          </label>
        ))}
      </fieldset>
      <SecretBindings
        secrets={tenant.secrets}
        onChange={(secrets) => onChange({ ...tenant, secrets })}
      />
      <p>
        Retain historical wrapping labels and versions. Changing key material
        requires the existing encryption migration safeguards.
      </p>
      {tenant.keySets.map((key, index) => (
        <fieldset key={index}>
          <legend>Key set {index + 1}</legend>
          <label>
            Key set reference / profile
            <input
              value={key.reference}
              onChange={(e) =>
                updateKey(index, { ...key, reference: e.target.value })
              }
            />
          </label>
          <label>
            Current wrapping label
            <input
              value={key.currentWrappingVersion}
              onChange={(e) =>
                updateKey(index, {
                  ...key,
                  currentWrappingVersion: e.target.value,
                })
              }
            />
          </label>
          {(["wrapping", "index", "control"] as const).map((role) => (
            <label key={role}>
              {role} ENV mapping
              <input
                value={key.mappings?.[role] ?? ""}
                onChange={(e) =>
                  updateKey(index, {
                    ...key,
                    mappings: {
                      wrapping: key.mappings?.wrapping ?? "",
                      index: key.mappings?.index ?? "",
                      control: key.mappings?.control ?? "",
                      [role]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
          <label>
            Index Vault version
            <input
              value={key.indexVersion ?? ""}
              placeholder="latest or immutable pin"
              onChange={(e) =>
                updateKey(index, { ...key, indexVersion: e.target.value })
              }
            />
          </label>
          <label>
            Control Vault version
            <input
              value={key.controlVersion ?? ""}
              placeholder="latest or immutable pin"
              onChange={(e) =>
                updateKey(index, { ...key, controlVersion: e.target.value })
              }
            />
          </label>
          {key.wrappingVersions.map((w, n) => (
            <fieldset key={n}>
              <legend>Retained wrapping version {n + 1}</legend>
              <label>
                Wrapping label
                <input
                  value={w.keyVersion}
                  onChange={(e) =>
                    updateKey(index, {
                      ...key,
                      wrappingVersions: key.wrappingVersions.map((v, i) =>
                        i === n ? { ...v, keyVersion: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Wrapping Vault version
                <input
                  value={w.vaultVersion ?? ""}
                  placeholder="latest or immutable pin"
                  onChange={(e) =>
                    updateKey(index, {
                      ...key,
                      wrappingVersions: key.wrappingVersions.map((v, i) =>
                        i === n ? { ...v, vaultVersion: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                className="secondary-button"
                onClick={() =>
                  updateKey(index, {
                    ...key,
                    wrappingVersions: key.wrappingVersions.filter(
                      (_, i) => i !== n,
                    ),
                  })
                }
              >
                Remove retained version {n + 1}
              </button>
            </fieldset>
          ))}
          <button
            className="secondary-button"
            onClick={() =>
              updateKey(index, {
                ...key,
                wrappingVersions: [
                  ...key.wrappingVersions,
                  { keyVersion: "", vaultVersion: "latest" },
                ],
              })
            }
          >
            Retain another wrapping version
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              onChange({
                ...tenant,
                keySets: tenant.keySets.filter((_, n) => n !== index),
              })
            }
          >
            Remove key set {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        className="secondary-button"
        onClick={() =>
          onChange({
            ...tenant,
            keySets: [
              ...tenant.keySets,
              {
                reference: "",
                currentWrappingVersion: "v1",
                wrappingVersions: [
                  { keyVersion: "v1", vaultVersion: "latest" },
                ],
                mappings: { wrapping: "", index: "", control: "" },
                indexVersion: "latest",
                controlVersion: "latest",
              },
            ],
          })
        }
      >
        Add existing key set
      </button>
    </section>
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
                  ? "Ready (consumer reported)"
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
        Authenticated consumer reports are observations, not independent
        attestations. Existing business tenant provisioning is required.
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
