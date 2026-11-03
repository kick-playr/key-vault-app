"use client";
import { VAULT_UI_REQUEST_TIMEOUT_MS } from "../lib/vault-request";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyIcon,
  LockClosedIcon,
  CommandLineIcon,
  ShieldCheckIcon,
  ArrowRightOnRectangleIcon,
  EyeIcon,
  EyeSlashIcon,
  Square2StackIcon,
} from "@heroicons/react/24/outline";
import {
  buildOperation,
  operations,
  type Fields,
  type Section,
} from "../lib/operations";
import { OperationForm } from "./operation-form";
import { DiscardDialog } from "./discard-dialog";
import { AzureVaultPanel } from "./azure-vault-panel";
import { ApplicationsPanel } from "./applications-panel";
import { RuntimeConfigurationPanel } from "./runtime-configuration-panel";
import { InventoryPanel } from "./inventory-panel";
import type { InventoryRow } from "../lib/inventory";
const environments = [
  { value: "development", label: "Development" },
  { value: "test", label: "Test" },
  { value: "preview", label: "Preview" },
  { value: "production", label: "Production" },
] as const;
type Connection = { environment: string; tenant: string; token: string };
const messages: Record<number, string> = {
  400: "The API rejected the request. Check the fields and manifest.",
  401: "Your session or vault token is invalid. Disconnect and sign in again.",
  403: "Your vault grant does not have permission for this operation or namespace.",
  404: "The resource or version was not found in this namespace.",
  409: "Revision conflict. Retry the original payload or use a newer configuration revision.",
  413: "The payload is too large.",
  429: "Too many requests. Wait before retrying.",
  503: "The vault provider is unavailable or not configured.",
  504: "The vault request timed out. Check its state before retrying a write.",
};
export function VaultConsole({ account }: { account?: React.ReactNode }) {
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [section, setSection] = useState<Section>("keys");
  const [applicationsOpen, setApplicationsOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [azureKind, setAzureKind] = useState<"keys" | "secrets" | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<() => void>();
  const dirtyInput = useRef(false);
  function guarded(action: () => void) {
    if (dirtyInput.current) setPendingNavigation(() => action);
    else action();
  }
  const [operationId, setOperationId] = useState("key-read");
  const [lastReconcile, setLastReconcile] = useState<Fields | null>(null);
  const [pendingVersion, setPendingVersion] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [formEpoch, setFormEpoch] = useState(0);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const statusRef = useRef<HTMLDivElement>(null);
  const operation = operations.find((op) => op.id === operationId)!;
  function clearOperation(resetForm = true) {
    setLastReconcile(null);
    if (resetForm) setPendingVersion("");
    sequence.current++;
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setConnecting(false);
    setResult(null);
    setRevealed(false);
    setMessage("");
    setError("");
    if (resetForm) setFormEpoch((v) => v + 1);
  }
  function disconnect() {
    dirtyInput.current = false;
    setPendingNavigation(undefined);
    clearOperation();
    setConnection(null);
    setSelectedName("");
  }
  useEffect(
    () => () => {
      sequence.current++;
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const clear = () => {
      sequence.current++;
      request.current?.abort();
      setResult(null);
      setRevealed(false);
      setConnection(null);
      setLastReconcile(null);
      setConnecting(false);
    };
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
  function navigate(next: Section, azure = false) {
    setApplicationsOpen(false);
    setRuntimeOpen(false);
    dirtyInput.current = false;
    setAzureKind(azure && next !== "advanced" ? next : null);
    clearOperation();
    setSection(next);
    setSelectedName("");
    setOperationId(
      next === "advanced"
        ? "reconcile"
        : next === "keys"
          ? "key-read"
          : "secret-read",
    );
  }
  async function connectToNamespace(form: HTMLFormElement) {
    const f = new FormData(form);
    const environment = String(f.get("environment") ?? "");
    const tenant = String(f.get("tenant") ?? "");
    const token = String(f.get("token") ?? "");
    if (
      !environments.some((option) => option.value === environment) ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(tenant) ||
      !/^[\x21-\x7e]{32,4096}$/.test(token)
    ) {
      setError("Enter a valid environment, tenant and vault token.");
      return;
    }
    clearOperation();
    const current = sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setConnecting(true);
    const tokenField = form.querySelector<HTMLInputElement>(
      'input[name="token"]',
    );
    if (tokenField) tokenField.value = "";
    try {
      const response = await fetch("/api/vault/local/session", {
        headers: {
          "x-vault-token": token,
          "x-vault-environment": environment,
          "x-vault-tenant": tenant,
        },
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(VAULT_UI_REQUEST_TIMEOUT_MS)]),
      });
      if (current !== sequence.current) return;
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Invalid vault token or sign-in session. Use the exact token."
            : response.status === 403
              ? "This token is not authorized for the selected environment and namespace."
              : "Vault authentication is unavailable. Update and restart the vault API, then retry.",
        );
        return;
      }
      const proof: unknown = await response.json();
      if (current !== sequence.current) return;
      if (
        !proof ||
        typeof proof !== "object" ||
        !("authenticated" in proof) ||
        proof.authenticated !== true ||
        !("environment" in proof) ||
        proof.environment !== environment ||
        !("tenant" in proof) ||
        proof.tenant !== tenant
      ) {
        setError(
          "Vault authentication returned an invalid response. Connection refused.",
        );
        return;
      }
      setConnection({ environment, tenant, token });
      form.reset();
    } catch {
      if (current === sequence.current && !controller.signal.aborted)
        setError(
          "Vault authentication failed or timed out. Connection refused.",
        );
    } finally {
      if (current === sequence.current) {
        setConnecting(false);
        request.current = null;
      }
    }
  }
  async function run(fields: Fields) {
    if (!connection) return;
    clearOperation(false);
    if (operationId === "reconcile") setLastReconcile({ ...fields });
    const current = sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const operationRequest = buildOperation(operationId, fields);
      const response = await fetch("/api/vault/" + operationRequest.path, {
        method: operationRequest.method,
        headers: {
          "x-vault-token": connection.token,
          "x-vault-environment": connection.environment,
          "x-vault-tenant": connection.tenant,
          ...(operationRequest.body
            ? { "content-type": "application/json" }
            : {}),
        },
        body: operationRequest.body
          ? JSON.stringify(operationRequest.body)
          : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
      if (current !== sequence.current) return;
      if (response.status === 401) {
        disconnect();
        setError(
          "Vault authentication expired or was revoked. Reconnect with a valid token.",
        );
        return;
      }
      if (!response.ok)
        throw Error(
          messages[response.status] ??
            "The vault operation failed. Check provider availability before retrying.",
        );
      const data: unknown = await response.json();
      if (current !== sequence.current) return;
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw Error("The vault returned an invalid response.");
      setResult(data as Record<string, unknown>);
      setMessage("Operation completed.");
      if (operationRequest.method !== "GET") setInventoryRevision((v) => v + 1);
      dirtyInput.current = false;
      if (section !== "advanced") {
        setSelectedName(fields.name ?? "");
      }
    } catch (e) {
      if (current === sequence.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "The vault is unavailable.");
    } finally {
      if (current === sequence.current) {
        setBusy(false);
        request.current = null;
        statusRef.current?.focus();
      }
    }
  }
  const versionRows =
    result && Array.isArray(result.value)
      ? result.value.filter(
          (v): v is Record<string, unknown> => !!v && typeof v === "object",
        )
      : [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Kick Playr Key Vault home">
          <span className="brand-mark">
            <KeyIcon />
          </span>
          <span>
            KICK PLAYR<small>Platform tools</small>
          </span>
        </a>
        <nav aria-label="Vault sections">
          <button
            className={
              "nav-item " + (applicationsOpen && runtimeOpen ? "active" : "")
            }
            aria-current={applicationsOpen && runtimeOpen ? "page" : undefined}
            onClick={() =>
              guarded(() => {
                dirtyInput.current = false;
                clearOperation();
                setAzureKind(null);
                setApplicationsOpen(true);
                setRuntimeOpen(true);
              })
            }
          >
            <Square2StackIcon />
            Runtime configuration
          </button>
          <button
            className={
              "nav-item " + (applicationsOpen && !runtimeOpen ? "active" : "")
            }
            onClick={() =>
              guarded(() => {
                dirtyInput.current = false;
                clearOperation();
                setAzureKind(null);
                setRuntimeOpen(false);
                setApplicationsOpen(true);
              })
            }
          >
            <Square2StackIcon />
            Applications
          </button>
          {(
            [
              { id: "keys", label: "Keys", Icon: KeyIcon },
              { id: "secrets", label: "Secrets", Icon: LockClosedIcon },
              { id: "advanced", label: "Advanced", Icon: CommandLineIcon },
              { id: "keys-azure", label: "Keys (Azure-style)", Icon: KeyIcon },
              {
                id: "secrets-azure",
                label: "Secrets (Azure-style)",
                Icon: LockClosedIcon,
              },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={
                "nav-item " +
                (!applicationsOpen &&
                (azureKind ? `${azureKind}-azure` === id : section === id)
                  ? "active"
                  : "")
              }
              aria-current={
                !applicationsOpen &&
                (azureKind ? `${azureKind}-azure` === id : section === id)
                  ? "page"
                  : undefined
              }
              onClick={() =>
                guarded(() =>
                  navigate(
                    id === "keys-azure"
                      ? "keys"
                      : id === "secrets-azure"
                        ? "secrets"
                        : id,
                    id.endsWith("-azure"),
                  ),
                )
              }
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheckIcon />
          <span>Local provider</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumbs">Key Vault</span>
          {connection && (
            <div
              className="topbar-context"
              role="group"
              aria-label="Active vault context"
            >
              <span className="live-dot" />
              <span className="namespace-label">
                <strong>{connection.environment}</strong>
                <span className="slash">/</span>
                {connection.tenant}
              </span>
              <button
                className="text-button"
                onClick={() => guarded(disconnect)}
              >
                <ArrowRightOnRectangleIcon />
                Disconnect
              </button>
            </div>
          )}
          {account && <div className="topbar-right">{account}</div>}
        </header>
        <main id="main-content">
          <div className="page-heading">
            <h1>
              {applicationsOpen
                ? runtimeOpen
                  ? "Runtime configuration"
                  : "Applications"
                : azureKind
                  ? `${azureKind === "keys" ? "Keys" : "Secrets"} (Azure-style)`
                  : section === "keys"
                    ? "Keys"
                    : section === "secrets"
                      ? "Secrets"
                      : "Advanced"}
            </h1>
          </div>
          {pendingNavigation && (
            <DiscardDialog
              onStay={() => setPendingNavigation(undefined)}
              onDiscard={() => {
                const action = pendingNavigation;
                setPendingNavigation(undefined);
                dirtyInput.current = false;
                action();
              }}
            />
          )}
          {!connection ? (
            <section
              className="panel connect-panel"
              aria-labelledby="connect-title"
            >
              <div className="panel-heading">
                <span className="section-icon">
                  <LockClosedIcon />
                </span>
                <div>
                  <h2 id="connect-title">Connect to a namespace</h2>
                  <p>Enter your scoped vault credentials.</p>
                </div>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void connectToNamespace(event.currentTarget);
                }}
                autoComplete="off"
              >
                <div className="field-grid">
                  <label className="field">
                    Environment
                    <select
                      name="environment"
                      disabled={connecting}
                      required
                      defaultValue="development"
                    >
                      {environments.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Tenant / namespace
                    <input
                      name="tenant"
                      disabled={connecting}
                      required
                      placeholder="club-id or _shared"
                      autoComplete="off"
                      pattern="[A-Za-z0-9_-]{1,64}"
                    />
                  </label>
                </div>
                <label className="field">
                  Vault bearer token
                  <input
                    name="token"
                    disabled={connecting}
                    type="password"
                    required
                    minLength={32}
                    maxLength={4096}
                    autoComplete="off"
                    placeholder="Scoped token from the vault administrator"
                  />
                </label>
                <button
                  className="button primary"
                  type="submit"
                  disabled={connecting}
                >
                  {connecting ? "Verifying token…" : "Connect to namespace"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
                {connecting && (
                  <>
                    <p role="status" className="form-note">
                      Authenticating with the vault…
                    </p>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => clearOperation()}
                    >
                      Cancel connection
                    </button>
                  </>
                )}
                <p className="form-note">
                  Token stays in memory for this tab. Nothing is saved in
                  browser storage.
                </p>
              </form>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </section>
          ) : applicationsOpen ? (
            <>
              {runtimeOpen ? (
                <RuntimeConfigurationPanel
                  key={`${connection.environment}/${connection.tenant}/applications`}
                  connection={connection}
                  onDirty={(value) => {
                    dirtyInput.current = value;
                  }}
                  onUnauthorized={() => {
                    disconnect();
                    setError(
                      "Vault authentication expired. Reconnect with a valid token.",
                    );
                  }}
                />
              ) : (
                <ApplicationsPanel
                  connection={connection}
                  onDirty={(value) => {
                    dirtyInput.current = value;
                  }}
                  onUnauthorized={() => {
                    disconnect();
                    setError(
                      "Vault authentication expired. Reconnect with a valid token.",
                    );
                  }}
                />
              )}
            </>
          ) : azureKind ? (
            <AzureVaultPanel
              key={`${connection.environment}/${connection.tenant}/${azureKind}/${formEpoch}`}
              kind={azureKind}
              connection={connection}
              onDirty={(value) => {
                dirtyInput.current = value;
              }}
              onMutation={() => setInventoryRevision((v) => v + 1)}
              onUnauthorized={() => {
                disconnect();
                setError(
                  "Vault authentication expired. Reconnect with a valid token.",
                );
              }}
            />
          ) : (
            <>
              <InventoryPanel
                key={`${connection.environment}/${connection.tenant}/${section}`}
                connection={connection}
                onUnauthorized={() => {
                  disconnect();
                  setError(
                    "Vault authentication expired or was revoked. Reconnect with a valid token.",
                  );
                }}
                section={section}
                revision={inventoryRevision}
                onSelect={(row: InventoryRow) => {
                  clearOperation();
                  setSection(row.kind === "key" ? "keys" : "secrets");
                  setSelectedName(row.name);
                  setPendingVersion(row.version);
                  setOperationId(
                    row.kind === "key" ? "key-read" : "secret-read",
                  );
                }}
              />
              <div
                className="content-grid"
                onChangeCapture={() => {
                  if (
                    ![
                      "key-read",
                      "secret-read",
                      "key-versions",
                      "secret-versions",
                    ].includes(operationId)
                  )
                    dirtyInput.current = true;
                }}
              >
                <section className="panel operation-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {section === "advanced"
                          ? "Manifest operations"
                          : "Actions"}
                      </h2>
                    </div>
                    <span className="permission-badge">
                      {operation.permission}
                    </span>
                  </div>
                  <label className="field">
                    Operation
                    <select
                      value={operationId}
                      onChange={(e) => {
                        clearOperation();
                        setOperationId(e.target.value);
                      }}
                    >
                      {operations
                        .filter((op) => op.section === section)
                        .map((op) => (
                          <option value={op.id} key={op.id}>
                            {op.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!operationId.endsWith("-delete") &&
                    !operationId.endsWith("-read") &&
                    !operationId.endsWith("-versions") && (
                      <p className="operation-description">
                        {operation.description}
                      </p>
                    )}
                  <OperationForm
                    key={`${operationId}-${formEpoch}`}
                    operation={operation}
                    name={selectedName}
                    version={pendingVersion}
                    onRun={run}
                    busy={busy}
                  />
                </section>
                <div className="right-column">
                  <section
                    className="panel result-panel"
                    aria-labelledby="result-title"
                  >
                    <div className="panel-heading">
                      <h2 id="result-title">Operation result</h2>
                      <span
                        className={
                          "status-dot " +
                          (busy ? "pending" : result ? "success" : "")
                        }
                      />
                    </div>
                    <div
                      ref={statusRef}
                      tabIndex={-1}
                      className="result-status"
                      aria-live="polite"
                    >
                      {busy && <p role="status">Waiting for the vault…</p>}
                      {message && <p className="success-text">{message}</p>}
                      {error && (
                        <p className="error" role="alert">
                          {error}
                        </p>
                      )}
                      {error && lastReconcile && !busy && (
                        <div>
                          <button
                            className="button secondary"
                            onClick={() => run(lastReconcile)}
                          >
                            Retry identical reconciliation
                          </button>
                          <p className="form-note">
                            Repeats the exact revision, manifest and supplied
                            secrets retained in memory. A new form submission
                            uses the current fields.
                          </p>
                        </div>
                      )}
                      {!busy && !result && !error && (
                        <p className="empty-state">No result yet.</p>
                      )}
                    </div>
                    {result && (
                      <>
                        <div className="sensitive-notice">
                          <LockClosedIcon />
                          <p>Sensitive result. Reveal only when needed.</p>
                        </div>
                        <button
                          className="button secondary reveal-button"
                          onClick={() => setRevealed((v) => !v)}
                        >
                          {revealed ? <EyeSlashIcon /> : <EyeIcon />}
                          {revealed ? "Hide result" : "Reveal result"}
                        </button>
                        {revealed ? (
                          <pre className="json-result">
                            {JSON.stringify(result, null, 2)}
                          </pre>
                        ) : (
                          <div
                            className="masked-result"
                            aria-label="Result masked"
                          >
                            •••• •••• ••••
                          </div>
                        )}
                        {versionRows.length > 0 && (
                          <div className="versions">
                            <h3>Versions</h3>
                            <ul>
                              {versionRows.map((row, index) => {
                                const resourceId =
                                  typeof row.kid === "string"
                                    ? row.kid
                                    : typeof row.id === "string"
                                      ? row.id
                                      : "";
                                const version =
                                  resourceId.split("/").pop() ?? "";
                                return (
                                  <li key={index}>
                                    <code>{version || "Unknown version"}</code>
                                    <button
                                      className="text-button"
                                      onClick={() => {
                                        clearOperation();
                                        setOperationId(
                                          section === "keys"
                                            ? "key-read"
                                            : "secret-read",
                                        );
                                        setFormEpoch((v) => v + 1);
                                        setPendingVersion(version);
                                      }}
                                    >
                                      Open version
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}
          {section === "advanced" && (
            <details className="provider-info">
              <summary>Provider limits</summary>
              <p>
                RSA 2048 / 3072 · RSA-OAEP-256 · Versioned secrets. No recovery,
                certificates, private-key export, migration jobs or
                grant-management API. Deletions are permanent.
              </p>
            </details>
          )}
        </main>
      </div>
    </div>
  );
}
