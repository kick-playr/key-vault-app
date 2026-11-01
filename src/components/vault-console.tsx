"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyIcon,
  LockClosedIcon,
  CommandLineIcon,
  ShieldCheckIcon,
  ArrowRightOnRectangleIcon,
  EyeIcon,
  EyeSlashIcon,
  ServerStackIcon,
} from "@heroicons/react/24/outline";
import {
  buildOperation,
  operations,
  type Fields,
  type Section,
} from "../lib/operations";
import { OperationForm } from "./operation-form";
type Connection = { environment: string; tenant: string; token: string };
type Resource = { name: string; section: "keys" | "secrets" };
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
  const [connection, setConnection] = useState<Connection | null>(null);
  const [section, setSection] = useState<Section>("keys");
  const [operationId, setOperationId] = useState("key-read");
  const [lastReconcile, setLastReconcile] = useState<Fields | null>(null);
  const [pendingVersion, setPendingVersion] = useState("");
  const [resources, setResources] = useState<Resource[]>([]);
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
    setResult(null);
    setRevealed(false);
    setMessage("");
    setError("");
    if (resetForm) setFormEpoch((v) => v + 1);
  }
  function disconnect() {
    clearOperation();
    setConnection(null);
    setResources([]);
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
      setResources([]);
      setLastReconcile(null);
    };
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
  function navigate(next: Section) {
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
      if (section !== "advanced") {
        setSelectedName(fields.name ?? "");
        setResources((previous) => {
          const rest = previous.filter(
            (item) => item.section !== section || item.name !== fields.name,
          );
          return operationId.endsWith("-delete")
            ? rest
            : [
                { name: fields.name!, section: section as "keys" | "secrets" },
                ...rest,
              ].slice(0, 100);
        });
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
        <div className="sidebar-label">WORKSPACE</div>
        <div className="workspace">
          <ServerStackIcon />
          <span>
            Key Vault<small>Local provider</small>
          </span>
          <span className="live-dot" />
        </div>
        <nav aria-label="Vault sections">
          {(
            [
              { id: "keys", label: "Keys", Icon: KeyIcon },
              { id: "secrets", label: "Secrets", Icon: LockClosedIcon },
              { id: "advanced", label: "Advanced", Icon: CommandLineIcon },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={"nav-item " + (section === id ? "active" : "")}
              aria-current={section === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon />
              {label}
              <span aria-hidden="true">
                {id === "advanced"
                  ? "↗"
                  : resources.filter((r) => r.section === id).length}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheckIcon />
          <strong>Scoped by design</strong>
          <p>
            Every operation is authorized by the vault for one environment and
            namespace.
          </p>
          <span className="provider-badge">LOCAL API · 2025-07-01</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Platform <span className="slash">/</span> Key Vault
          </span>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="live-dot" />
              Local development
            </span>
            {account}
          </div>
        </header>
        <main id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">VAULT MANAGEMENT</p>
              <h1>
                {section === "keys"
                  ? "Keys"
                  : section === "secrets"
                    ? "Secrets"
                    : "Advanced operations"}
              </h1>
              <p className="subtitle">
                {section === "keys"
                  ? "Manage encryption keys and their lifecycle."
                  : section === "secrets"
                    ? "Manage secret values, versions and metadata."
                    : "Provision manifests and inspect runtime mappings."}
              </p>
            </div>
            <span className="outline-badge">
              <ShieldCheckIcon />
              Private key material never leaves the vault
            </span>
          </div>
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
                  <p>
                    Sign-in identifies you. A scoped vault token authorizes your
                    operations.
                  </p>
                </div>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const f = new FormData(form);
                  const environment = String(f.get("environment") ?? "");
                  const tenant = String(f.get("tenant") ?? "");
                  const token = String(f.get("token") ?? "");
                  if (
                    !/^[A-Za-z0-9_-]{1,64}$/.test(environment) ||
                    !/^[A-Za-z0-9_-]{1,64}$/.test(tenant) ||
                    !/^\S{32,4096}$/.test(token)
                  ) {
                    setError(
                      "Enter valid environment and tenant identifiers and a token of at least 32 characters.",
                    );
                    return;
                  }
                  clearOperation();
                  setConnection({ environment, tenant, token });
                  form.reset();
                }}
                autoComplete="off"
              >
                <div className="field-grid">
                  <label className="field">
                    Environment
                    <input
                      name="environment"
                      required
                      placeholder="dev"
                      autoComplete="off"
                      pattern="[A-Za-z0-9_-]{1,64}"
                    />
                  </label>
                  <label className="field">
                    Tenant / namespace
                    <input
                      name="tenant"
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
                    type="password"
                    required
                    minLength={32}
                    maxLength={4096}
                    autoComplete="off"
                    placeholder="Scoped token from the vault administrator"
                  />
                </label>
                <button className="button primary" type="submit">
                  Connect to namespace <span aria-hidden="true">→</span>
                </button>
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
          ) : (
            <>
              <section
                className="context-bar"
                aria-label="Active vault context"
              >
                <div>
                  <span className="live-dot" />
                  <strong>{connection.environment}</strong>
                  <span className="slash">/</span>
                  <span>{connection.tenant}</span>
                </div>
                <button className="text-button" onClick={disconnect}>
                  <ArrowRightOnRectangleIcon />
                  Disconnect
                </button>
              </section>
              <div className="content-grid">
                <section className="panel operation-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">
                        {section === "advanced"
                          ? "PROVISIONING"
                          : "RESOURCE OPERATIONS"}
                      </p>
                      <h2>{operation.label}</h2>
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
                  {!operationId.endsWith("-delete") && (
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
                        <div className="empty-state">
                          <CommandLineIcon />
                          <h3>Ready when you are</h3>
                          <p>Run an operation to see its response here.</p>
                        </div>
                      )}
                    </div>
                    {result && (
                      <>
                        <div className="sensitive-notice">
                          <LockClosedIcon />
                          <p>
                            Responses may contain sensitive values. Reveal only
                            when needed.
                          </p>
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
                  {section !== "advanced" && (
                    <section className="panel session-panel">
                      <div className="panel-heading">
                        <h2>Opened this session</h2>
                        <span className="count">
                          {
                            resources.filter((r) => r.section === section)
                              .length
                          }
                        </span>
                      </div>
                      <p className="form-note">
                        A session history, not a complete vault inventory.
                      </p>
                      {resources.filter((r) => r.section === section).length ===
                      0 ? (
                        <p className="session-empty">
                          Open or create a resource to add it here.
                        </p>
                      ) : (
                        <ul className="resource-list">
                          {resources
                            .filter((r) => r.section === section)
                            .map((r) => (
                              <li key={r.name}>
                                <button
                                  onClick={() => {
                                    clearOperation();
                                    setSelectedName(r.name);
                                    setOperationId(
                                      section === "keys"
                                        ? "key-read"
                                        : "secret-read",
                                    );
                                  }}
                                >
                                  <KeyIcon />
                                  <span>{r.name}</span>
                                  <span aria-hidden="true">↗</span>
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  )}
                </div>
              </div>
            </>
          )}
          <section className="capabilities">
            <ShieldCheckIcon />
            <div>
              <h3>Know your provider</h3>
              <p>
                RSA 2048 / 3072 · RSA-OAEP-256 · Versioned secrets · Manifest
                provisioning. No recovery, certificates, private-key export,
                migration jobs or grant-management API. Deletions are permanent.
              </p>
            </div>
          </section>
          <footer>
            Kick Playr <span> / </span> Key Vault <span>·</span> Independent
            administration
          </footer>
        </main>
      </div>
    </div>
  );
}
