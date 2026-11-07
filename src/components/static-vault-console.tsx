"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  KeyIcon, LockClosedIcon, ShieldCheckIcon, Square2StackIcon,
} from "@heroicons/react/24/outline";
import { loadResourceCatalogue } from "../lib/static-resource-catalogue";
import { IntegrationEditor } from "./integration-editor";
import { TenantConsentPanel } from "./tenant-consent-panel";
import { KeyRotationPanel } from "./key-rotation-panel";
type Resource = {
  _id: string;
  name: string;
  kind: string;
  currentVersionId: string;
  currentVersionNumber: number;
  revision: number;
  enabled?: boolean;
  custody?: "admin-managed" | "workload-only";
  ownerType?: "application" | "tenant";
  ownerId?: string;
};
const applicationName = (app: { name?: string; displayName?: string; _id: string }) => app.name || app.displayName || app._id;
type ConsoleView = "runtime" | "applications" | "keys" | "secrets";
type Link = { resourceId: string; accessName: string; versionPolicy: string };
export function StaticResourceTable({
  resources,
  links,
  onSave,
  disabled = false,
}: {
  resources: Resource[];
  links: Link[];
  onSave: (rows: Link[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Record<string, Link>>(() =>
      Object.fromEntries(links.map((l) => [l.resourceId, l])),
    ),
    [search, setSearch] = useState(""),
    [env, setEnv] = useState(""),
    [filter, setFilter] = useState<"all" | "linked" | "unlinked">("all"),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false);
  const filtered = resources.filter(
      (r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) &&
        (selected[r._id]?.accessName ?? "")
          .toLowerCase()
          .includes(env.toLowerCase()) &&
        (filter === "all" || (filter === "linked") === !!selected[r._id]),
    ),
    pages = Math.max(1, Math.ceil(filtered.length / 20)),
    current = Math.min(page, pages - 1);
  const update = (id: string, patch: Partial<Link>) =>
    setSelected({ ...selected, [id]: { ...selected[id]!, ...patch } });
  return (
    <>
      <div className="application-links-scroll">
        <table className="application-links-table">
          <thead>
            <tr>
              <th>
                Link{" "}
                <button
                  aria-label="Linked"
                  aria-pressed={filter === "linked"}
                  onClick={() => {
                    setFilter(filter === "linked" ? "all" : "linked");
                    setPage(0);
                  }}
                >
                  ☑
                </button>
                <button
                  aria-label="Unlinked"
                  aria-pressed={filter === "unlinked"}
                  onClick={() => {
                    setFilter(filter === "unlinked" ? "all" : "unlinked");
                    setPage(0);
                  }}
                >
                  ☐
                </button>
              </th>
              <th>
                Secret / key purpose
                <input
                  type="search"
                  aria-label="Search key"
                  placeholder="Search key"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
              </th>
              <th>ID</th>
              <th>Version</th>
              <th>
                ENV / access name
                <input
                  type="search"
                  aria-label="Filter by ENV"
                  placeholder="ENV"
                  value={env}
                  onChange={(e) => {
                    setEnv(e.target.value);
                    setPage(0);
                  }}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 20, current * 20 + 20).map((resource) => (
              <tr key={resource._id} className={selected[resource._id] ? "is-linked" : undefined}>
                <td>
                  <input
                    aria-label={`Link ${resource.name}`}
                    type="checkbox"
                    disabled={disabled || busy}
                    checked={!!selected[resource._id]}
                    onChange={(e) => {
                      if (e.target.checked)
                        setSelected({
                          ...selected,
                          [resource._id]: {
                            resourceId: resource._id,
                            accessName: "",
                            versionPolicy: "latest",
                          },
                        });
                      else {
                        const next = { ...selected };
                        delete next[resource._id];
                        setSelected(next);
                      }
                    }}
                  />
                </td>
                <td>
                  <strong>{resource.name}</strong>
                  <small style={{ display: "block" }}>{resource.kind}</small>
                </td>
                <td>
                  <code title={resource._id}>
                    {resource._id.length > 20
                      ? resource._id.slice(0, 18) + "…"
                      : resource._id}
                  </code>
                </td>
                <td>
                  {selected[resource._id] ? (
                    <>
                      <select
                        aria-label={`Version ${resource.name}`}
                        disabled={disabled || busy}
                        value={
                          selected[resource._id]!.versionPolicy === "latest"
                            ? "latest"
                            : "pinned"
                        }
                        onChange={(e) =>
                          update(resource._id, {
                            versionPolicy:
                              e.target.value === "latest"
                                ? "latest"
                                : resource.currentVersionId,
                          })
                        }
                      >
                        <option value="latest">Latest</option>
                        <option value="pinned">Specific version</option>
                      </select>
                      {selected[resource._id]!.versionPolicy !== "latest" && (
                        <input
                          aria-label={`Version ID ${resource.name}`}
                          value={selected[resource._id]!.versionPolicy}
                          disabled={disabled || busy}
                          onChange={(e) =>
                            update(resource._id, {
                              versionPolicy: e.target.value,
                            })
                          }
                        />
                      )}
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td>
                  {selected[resource._id] && (
                    <input
                      aria-label={`ENV ${resource.name}`}
                      disabled={disabled || busy}
                      value={selected[resource._id]!.accessName}
                      onChange={(e) =>
                        update(resource._id, { accessName: e.target.value })
                      }
                      placeholder="CLERK_SECRET_KEY"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="application-links-pagination">
        <span>{filtered.length} resources</span>
        {pages > 1 && (
          <div>
            <button
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </button>
            <span>
              {" "}
              {current + 1} / {pages}{" "}
            </span>
            <button
              disabled={current + 1 >= pages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
        )}
        <button
          className="primary-button"
          disabled={
            disabled ||
            busy ||
            Object.values(selected).some(
              (l) => !/^[A-Z][A-Z0-9_]{0,127}$/.test(l.accessName),
            )
          }
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(Object.values(selected));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save links"}
        </button>
      </div>
    </>
  );
}
export function StaticVaultConsole({ account }: { account?: React.ReactNode }) {
  const [view, setView] = useState<ConsoleView>("runtime"),
    [listSearch, setListSearch] = useState(""),
    [listPage, setListPage] = useState(0),
    [tenantApplication, setTenantApplication] = useState("club-api");
  const [ownerType, setOwnerType] = useState("application"),
    [ownerId, setOwnerId] = useState("vault-app"),
    [tenant, setTenant] = useState(""),
    [model, setModel] = useState<any>(),
    [resources, setResources] = useState<Resource[]>([]),
    [links, setLinks] = useState<Link[]>([]),
    [revision, setRevision] = useState(0),
    [expanded, setExpanded] = useState(false),
    [create, setCreate] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [canWrite, setCanWrite] = useState(false),
    [canRead, setCanRead] = useState(false),
    [canExportKeys, setCanExportKeys] = useState(false),
    [canRotate, setCanRotate] = useState(false),
    [canManageGrants, setCanManageGrants] = useState(false),
    [grantDeliveryAvailable, setGrantDeliveryAvailable] = useState(false),
    [consent, setConsent] = useState<any>(),
    [integration, setIntegration] = useState(""),
    [schema, setSchema] = useState<any>(),
    [integrationName, setIntegrationName] = useState(""),
    [epoch, setEpoch] = useState(0);
  const application = ownerType === "application" ? ownerId : tenantApplication;
  const shownResources = resources.filter(resource => view === "keys" ? resource.kind === "encryption-key" : view === "secrets" ? resource.kind !== "encryption-key" : true);
  const applications = (model?.applications ?? []).filter((app: any) => `${applicationName(app)} ${app._id} ${app.description ?? ""}`.toLowerCase().includes(listSearch.trim().toLowerCase()));
  const tenants = (model?.tenants ?? []).filter((row: any) => `${row.displayName ?? row.name ?? ""} ${row._id}`.toLowerCase().includes(listSearch.trim().toLowerCase()));
  const listRows = view === "runtime" ? tenants : applications;
  const listPages = Math.max(1, Math.ceil(listRows.length / 20)), currentListPage = Math.min(listPage, listPages - 1);
  function navigate(next: ConsoleView) { if (next === "applications" && ownerType === "tenant") { setOwnerType("application"); setOwnerId(tenantApplication); } setView(next); setExpanded(false); setCreate(false); setListSearch(""); setListPage(0); }
  const currentScope = useRef("");
  currentScope.current = ownerType + "/" + ownerId + "/" + application;
  const requestSequence = useRef(0);
  const call = useCallback(
    async (
      path: string,
      method = "GET",
      body?: unknown,
      override?: { ownerType: string; ownerId: string },
    ) => {
      const query = new URLSearchParams({
        environment: "development",
        ownerType: override?.ownerType ?? ownerType,
        ownerId: override?.ownerId ?? ownerId,
      });
      const [pathname, extra] = path.split("?");
      if (extra)
        for (const [key, value] of new URLSearchParams(extra))
          query.set(key, value);
      const response = await fetch("/api/vault-v2/" + pathname + "?" + query, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      if (!response.ok)
        throw Error(
          response.status === 403
            ? "Tenant approval or permission is required."
            : "Vault request failed. Reload before retrying.",
        );
      return response.headers.get("content-type")?.includes("application/json")
        ? response.json()
        : response.text();
    },
    [ownerType, ownerId],
  );
  const reload = useCallback(async () => {
    const sequence=++requestSequence.current, requestedScope=currentScope.current;
    const current=()=>sequence===requestSequence.current && requestedScope===currentScope.current;
    setError("");
    setCanRead(false);setCanWrite(false);setCanExportKeys(false);setCanRotate(false);setCanManageGrants(false);
    setResources([]);setLinks([]);setModel(undefined);setConsent(undefined);
    try {
      const [catalog, access, linked, rows, nextConsent] = await Promise.all([
        call("catalog"), call("access"), call("links/" + application),
        loadResourceCatalogue<Resource>(call), ownerType === "tenant" ? call("consent") : Promise.resolve(undefined),
      ]);
      if(!current())return;
      setModel(catalog);
      setCanWrite(access.canWrite);setCanRead(access.canRead);setCanExportKeys(access.canExportKeys);setCanRotate(access.canRotate);
      setCanManageGrants(access.canManageGrants);setGrantDeliveryAvailable(access.grantDeliveryAvailable);
      setLinks(linked.links);setRevision(linked.deployment?.revision ?? 0);
      setResources([...new Map([...rows, ...(linked.sharedResources ?? [])].map(resource => [resource._id,resource])).values()]);setEpoch(v=>v+1);setConsent(nextConsent);
    } catch(e) { if(current())setError((e as Error).message); }
  },[call,application,ownerType]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function action(work: () => Promise<unknown>) {
    setError("");
    setNotice("");
    try {
      await work();
      setNotice("Saved");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="app-shell static-vault-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Kick Playr Key Vault home">
          <span className="brand-mark"><KeyIcon /></span>
          <span>KICK PLAYR<small>Platform tools</small></span>
        </a>
        <nav aria-label="Vault sections">
          {([
            { id: "runtime", label: "Runtime configuration", Icon: Square2StackIcon },
            { id: "applications", label: "Applications", Icon: Square2StackIcon },
            { id: "keys", label: "Keys", Icon: KeyIcon },
            { id: "secrets", label: "Secrets", Icon: LockClosedIcon },
          ] as const).map(({ id, label, Icon }) => <button key={id}
            className={"nav-item " + (view === id ? "active" : "")}
            aria-current={view === id ? "page" : undefined}
            onClick={() => navigate(id)}><Icon />{label}</button>)}
        </nav>
        <div className="sidebar-bottom"><ShieldCheckIcon /><span>Vault provider</span></div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumbs">Key Vault</span>
          <div className="topbar-context" role="group" aria-label="Active vault context">
            <span className="live-dot" /><span className="namespace-label"><strong>development</strong><span className="slash">/</span>{ownerId}</span>
          </div>
          {account && <div className="topbar-right">{account}</div>}
        </header>
        <main id="main-content" className="applications-layout">
          <div className="page-heading"><h1>{view === "runtime" ? "Runtime configuration" : view === "applications" ? "Applications" : view === "keys" ? "Keys" : "Secrets"}</h1>
            <button className="button secondary" onClick={() => void reload()}>Refresh</button>
          </div>
          <section className="panel vault-scope-panel" aria-label="Vault scope">
            <label className="field">Scope<select value={ownerType} onChange={event => { setOwnerType(event.target.value); setOwnerId(event.target.value === "application" ? "vault-app" : tenant || "fcrww"); setExpanded(false); }}><option value="application">Application</option><option value="tenant">Tenant</option></select></label>
            {ownerType === "application" ? <label className="field">Application<select value={ownerId} onChange={event => { setOwnerId(event.target.value); setExpanded(false); }}>
              {!model?.applications?.some((app: any) => app._id === ownerId) && <option value={ownerId}>{ownerId}</option>}
              {(model?.applications ?? []).map((app: any) => <option key={app._id} value={app._id}>{applicationName(app)}</option>)}
            </select></label> : <form className="vault-tenant-open" onSubmit={event => { event.preventDefault(); if (tenant.trim()) { setOwnerId(tenant.trim()); setExpanded(false); } }}><label className="field">Tenant<input aria-label="Tenant slug" value={tenant} onChange={event => setTenant(event.target.value)} placeholder={ownerId} /></label><button className="button secondary" disabled={!tenant.trim()}>Open tenant</button></form>}
          </section>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="panel">
        <div className="applications-catalog-heading">
          <div><h2>{view === "runtime" ? "Tenants" : view === "applications" ? "Application model" : ownerId}</h2><p className="muted">{view === "runtime" ? "Combine applications and tenants. Secret names, versions and ENV mappings are managed in Applications." : "Manage resource links, versions and ENV mappings."}</p></div>
          {view === "applications" && ownerType === "application" && (
            <button className="primary-button" onClick={() => setCreate(!create)}>New application</button>
          )}
        </div>
        {create && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget),
                id = String(data.get("id"));
              void action(() =>
                call(
                  "applications",
                  "PUT",
                  {
                    id,
                    name: String(data.get("name")),
                    description: String(data.get("description")),
                    revision: 0,
                  },
                  { ownerType: "application", ownerId: id },
                ),
              );
              setCreate(false);
            }}
            className="application-create-form vault-inline-form"
          >
            <input
              name="id"
              aria-label="Application slug"
              placeholder="club-api"
              required
              pattern="[a-z][a-z0-9-]*"
            />
            <input
              name="name"
              aria-label="Application name"
              placeholder="Club API"
              required
            />
            <input
              name="description"
              aria-label="Description"
              placeholder="Purpose and usage"
            />
            <button className="primary-button">Create application</button>
          </form>
        )}
        {(view === "applications" || view === "runtime") && <label className="field vault-list-search">{view === "runtime" ? "Search tenants" : "Search applications"}<input type="search" value={listSearch} onChange={event => { setListSearch(event.target.value); setListPage(0); }} placeholder={view === "runtime" ? "Tenant name or slug" : "Name, slug or description"} /></label>}
        {view === "runtime" && <div className="applications-catalog-scroll"><table className="applications-catalog-table"><thead><tr><th>Tenant</th><th>Assigned applications</th><th>Inherited bindings</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
          {tenants.slice(currentListPage * 20, currentListPage * 20 + 20).map((row: any) => <tr key={row._id} className={ownerType === "tenant" && ownerId === row._id ? "is-selected" : undefined}>
            <th scope="row">{row.displayName ?? row.name ?? row._id}<small className="vault-slug">{row._id}</small></th>
            <td>{(model?.assignments ?? []).filter((assignment: any) => assignment.tenantId === row._id && assignment.enabled).map((assignment: any) => applicationName((model?.applications ?? []).find((app: any) => app._id === assignment.applicationId) ?? { _id: assignment.applicationId })).join(", ") || "No applications assigned"}</td>
            <td>{ownerType === "tenant" && ownerId === row._id && expanded ? `${resources.filter(resource => resource.kind !== "encryption-key").length} secrets / integrations, ${resources.filter(resource => resource.kind === "encryption-key").length} keys` : "Expand to view"}</td>
            <td><button className="vault-expand-button" aria-label={`${expanded && ownerType === "tenant" && ownerId === row._id ? "Collapse" : "Expand"} tenant ${row._id}`} aria-expanded={expanded && ownerType === "tenant" && ownerId === row._id} onClick={() => { setTenant(row._id); setOwnerType("tenant"); setOwnerId(row._id); setExpanded(ownerType === "tenant" && ownerId === row._id ? !expanded : true); }}>{expanded && ownerType === "tenant" && ownerId === row._id ? <ChevronUpIcon /> : <ChevronDownIcon />}</button></td>
          </tr>)}
        </tbody></table></div>}
        {view === "applications" && ownerType === "application" && (
          <div className="applications-catalog-scroll"><table className="applications-catalog-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Slug</th>
                <th>Description</th>
                <th>Tenants</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {applications.slice(currentListPage * 20, currentListPage * 20 + 20).map((app: any) => (
                <tr key={app._id} className={ownerId === app._id ? "is-selected" : undefined}>
                  <td>
                    <label
                      style={{ display: "flex", gap: 10, alignItems: "center" }}
                    >
                      <input
                        type="checkbox"
                        checked={ownerId === app._id}
                        onChange={() => {
                          setOwnerId(app._id);
                          setExpanded(false);
                        }}
                      />
                      {applicationName(app)}
                    </label>
                  </td>
                  <td>
                    <code>{app._id}</code>
                  </td>
                  <td>{app.description}</td>
                  <td>
                    {
                      model.assignments.filter(
                        (a: any) => a.applicationId === app._id && a.enabled,
                      ).length
                    }
                  </td>
                  <td>
                    <button
                      className="vault-expand-button"
                      aria-label={`${expanded && ownerId === app._id ? "Collapse" : "Expand"} ${applicationName(app)}`}
                      aria-expanded={expanded && ownerId === app._id}
                      onClick={() => {
                        setOwnerId(app._id);
                        setExpanded(ownerId === app._id ? !expanded : true);
                      }}
                    >
                      {expanded && ownerId === app._id ? (
                        <ChevronUpIcon width={20} />
                      ) : (
                        <ChevronDownIcon width={20} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {(view === "runtime" || view === "applications") && listPages > 1 && <div className="application-links-pagination"><span>{listRows.length} {view === "runtime" ? "tenants" : "applications"} · {currentListPage + 1} / {listPages}</span><button disabled={currentListPage === 0} onClick={() => setListPage(currentListPage - 1)}>Previous</button><button disabled={currentListPage + 1 >= listPages} onClick={() => setListPage(currentListPage + 1)}>Next</button></div>}
        {view === "applications" && ownerType === "tenant" && (
          <button
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
            }}
          >
            {ownerId}
            {expanded ? (
              <ChevronUpIcon width={20} />
            ) : (
              <ChevronDownIcon width={20} />
            )}
          </button>
        )}
        {(expanded || view === "keys" || view === "secrets") && (
          <div className="application-detail vault-resource-details">
            <h3>{view === "keys" ? "Encryption keys" : view === "secrets" ? "Secrets & integrations" : ownerId + " · Secrets, keys & integrations"}</h3>
            {ownerType === "tenant" && <label className="field vault-list-search">Consuming application<select value={tenantApplication} onChange={event => setTenantApplication(event.target.value)}>{(model?.applications ?? []).map((app: any) => <option value={app._id} key={app._id}>{applicationName(app)}</option>)}</select></label>}
            {!canWrite && (
              <p>
                Metadata only. Tenant approval is required to view or edit
                values.
              </p>
            )}
            <StaticResourceTable
              key={epoch}
              resources={shownResources}
              links={links}
              disabled={!canWrite}
              onSave={(rows) =>
                action(() =>
                  call("links/" + application, "PUT", { revision, rows }),
                )
              }
            />
            <details>
              <summary>Resources and versions</summary>
              {shownResources.map((resource) => (
                <details key={resource._id}>
                  <summary>
                    {resource.name} · {resource.kind} · version{" "}
                    {resource.currentVersionNumber}
                  </summary>
                  <ResourceDetails
                    resource={resource}
                    targets={(model?.applications ?? []).filter((app: any) => app._id !== resource.ownerId)}
                    canonicalAccessName={links.find(link => link.resourceId === resource._id)?.accessName}
                    canRead={
                      resource.kind === "encryption-key"
                        ? canExportKeys
                        : canRead
                    }
                    canRotate={canRotate}
                    disabled={!canWrite}
                    call={call}
                    action={action}
                  />
                </details>
              ))}
            </details>
            <details>
              <summary>Add secret or encryption key</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action(() =>
                    call("resources", "POST", {
                      name: String(data.get("name")),
                      kind: String(data.get("kind")),
                      valueFormat: String(data.get("format")),
                      value: String(data.get("value")),
                    }),
                  );
                  event.currentTarget.reset();
                }}
              >
                <input
                  name="name"
                  placeholder="Secret purpose"
                  required
                  disabled={!canWrite}
                />
                <select name="kind" disabled={!canWrite}>
                  <option value="secret">Secret</option>
                  <option value="encryption-key" disabled={ownerType === "application"}>256-bit encryption key</option>
                </select>
                {ownerType === "application" && <p>Application encryption keys and database credentials are provisioned through the deployment operator.</p>}
                <select name="format" disabled={!canWrite}>
                  <option value="text">Plain text</option>
                  <option value="base64">Base64</option>
                  <option value="hex64">64 hexadecimal characters</option>
                </select>
                <input
                  name="value"
                  type="password"
                  autoComplete="off"
                  placeholder="Value"
                  required
                  disabled={!canWrite}
                />
                <button disabled={!canWrite}>Save resource</button>
              </form>
            </details>
            <details>
              <summary>Add named integration</summary>
              <label>
                Type
                <select
                  value={integration}
                  onChange={async (e) => {
                    setIntegration(e.target.value);
                    if (e.target.value)
                      setSchema(
                        await call(
                          "schemas/" +
                            encodeURIComponent(
                              "builtin:" + e.target.value + (["email","pingen"].includes(e.target.value) ? "@2" : "@1"),
                            ),
                        ),
                      );
                  }}
                >
                  <option value="">Choose…</option>
                  {["bexio", "dropbox", "pingen", "email"].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                Integration name
                <input
                  value={integrationName}
                  onChange={(e) => setIntegrationName(e.target.value)}
                  placeholder="Bexio Accounting"
                />
              </label>
              {schema && (
                <IntegrationEditor
                  key={integration}
                  schema={schema}
                  disabled={!canWrite || !integrationName.trim()}
                  onSave={(value) =>
                    action(() =>
                      call("resources", "POST", {
                        name: integrationName,
                        kind: "integration",
                        schemaIdentity: "builtin:" + integration + (["email","pingen"].includes(integration) ? "@2" : "@1"),
                        value,
                      }),
                    )
                  }
                />
              )}
            </details>
            {consent && (
              <TenantConsentPanel
                enabled={consent.enabled}
                canManage={consent.canManage}
                onChange={(enabled) =>
                  action(() =>
                    call("consent", "PUT", {
                      revision: consent.revision,
                      enabled,
                    }),
                  )
                }
              />
            )}
            {ownerType === "application" && <details>
              <summary>Application access grants</summary>
              <p>Passwords go only to the configured deployment channel. This screen shows metadata.</p>
              {!grantDeliveryAvailable && <p>Grant delivery must be configured by the deployment operator.</p>}
              <button disabled={!canManageGrants || !grantDeliveryAvailable || (model?.grants ?? []).some((grant: any) => grant.applicationId === ownerId && grant.grantClass === "application" && grant.enabled)} onClick={() => void action(() => call("applications/" + ownerId + "/grants", "POST"))}>Issue application grant</button>
              {(model?.grants ?? []).filter((grant: any) => grant.applicationId === ownerId && grant.grantClass === "application").map((grant: any) => <div key={grant._id}>
                <code>{grant._id}</code><span> · {grant.enabled ? "Active" : "Inactive"} · revision {grant.revision}</span>
                <button disabled={!canManageGrants || !grantDeliveryAvailable || !grant.enabled} onClick={() => { if (window.confirm("Rotate this application grant? Install the new deployment credential before the next background check.")) void action(() => call("grants/" + grant._id + "/rotate", "POST", { revision: grant.revision })); }}>Rotate grant</button>
                <button disabled={!canManageGrants || !grantDeliveryAvailable || !grant.enabled} onClick={() => { if (window.confirm("Revoke this application grant? The application will lose access at its next background check.")) void action(() => call("grants/" + grant._id, "DELETE", { revision: grant.revision })); }}>Revoke grant</button>
              </div>)}
            </details>}
            <KeyRotationPanel
              instances={model?.instances ?? []}
              onRetire={(id, confirmation, reason) =>
                action(() =>
                  call(
                    "instances/" + id + "/retire",
                    "POST",
                    { confirmation, reason },
                    { ownerType: "application", ownerId: application },
                  ),
                )
              }
            />
          </div>
        )}
      </section>
        </main>
      </div>
    </div>
  );
}
export function ResourceDetails({
  resource,
  canRead,
  canRotate,
  disabled,
  call,
  action,
  targets = [],
  canonicalAccessName = "",
}: {
  resource: Resource;
  targets?: { _id: string; name?: string; displayName?: string }[];
  canonicalAccessName?: string;
  canRead: boolean;
  canRotate: boolean;
  disabled: boolean;
  call: (path: string, method?: string, body?: unknown, override?: {ownerType:string;ownerId:string}) => Promise<any>;
  action: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [shareTarget,setShareTarget]=useState(""),[shareAccess,setShareAccess]=useState(canonicalAccessName);
  const workloadOnly = resource.custody === "workload-only";
  const [value, setValue] = useState<string>();
  useEffect(() => {
    setValue(undefined);
  }, [resource._id, resource.currentVersionId, resource.custody]);
  const [rotationStatus, setRotationStatus] = useState<{
    rotations: { _id: string; state: string; newVersionId: string }[];
    participants: {
      rotationId: string;
      acknowledged: boolean;
      retired: boolean;
      instanceId: string;
    }[];
  }>();
  return (
    <div style={{ padding: 12 }}>
      <code>{resource._id}</code>
      <p>Version: {resource.currentVersionId}</p>
      {resource.ownerType === "application" && <p>Owned by application: {resource.ownerId}</p>}
      {resource.ownerType === "application" && targets.length > 0 && <details>
        <summary>Link this resource to another application</summary>
        <p>The applications share this resource and version history using the same ENV name.</p>
        <label>Application<select value={shareTarget} disabled={disabled} onChange={event=>setShareTarget(event.target.value)}><option value="">Choose…</option>{targets.map(target=><option key={target._id} value={target._id}>{applicationName(target)}</option>)}</select></label>
        <label>ENV name<input value={shareAccess} disabled={disabled} onChange={event=>setShareAccess(event.target.value)} placeholder="SHARED_SECRET" /></label>
        <button disabled={disabled || !shareTarget || !/^[A-Z][A-Z0-9_]{0,127}$/.test(shareAccess)} onClick={()=>void action(()=>call("links/"+shareTarget,"POST",{resourceId:resource._id,accessName:shareAccess,versionPolicy:"latest"},{ownerType:"application",ownerId:resource.ownerId!}))}>Link shared resource</button>
      </details>}
      {workloadOnly && (
        <p role="note">
          Workload-only: applications can load this resource. Values and changes
          use the deployment operator path.
        </p>
      )}
      <button
        disabled={!canRead || workloadOnly}
        onClick={() =>
          void action(async () => {
            const data = await call(
              "resources/" +
                resource._id +
                "/reveal/" +
                resource.currentVersionId,
              "POST",
            );
            setValue(typeof data === "string" ? data : JSON.stringify(data));
          })
        }
      >
        Reveal value
      </button>
      {value && !workloadOnly && (
        <div>
          <pre>{value}</pre>
          <button onClick={() => setValue(undefined)}>Hide value</button>
        </div>
      )}
      <button
        disabled={disabled || workloadOnly}
        onClick={() =>
          void action(() =>
            call("resources/" + resource._id + "/enabled", "PUT", {
              revision: resource.revision,
              enabled: resource.enabled === false,
            }),
          )
        }
      >
        {resource.enabled === false
          ? "Enable resource"
          : "Revoke resource access"}
      </button>
      {resource.kind === "encryption-key" && (
        <section>
          <button
            disabled={!canRotate || workloadOnly}
            onClick={() =>
              void action(() =>
                call("resources/" + resource._id + "/rotations", "POST", {
                  revision: resource.revision,
                }),
              )
            }
          >
            Prepare new key version
          </button>
          <button
            onClick={() =>
              void action(async () => {
                setRotationStatus(
                  await call("resources/" + resource._id + "/rotations"),
                );
              })
            }
          >
            Refresh rotation status
          </button>
          {rotationStatus?.rotations.map((job) => (
            <div key={job._id}>
              <strong>{job.state}</strong>
              <p>New version: {job.newVersionId}</p>
              <p>
                Waiting:{" "}
                {rotationStatus.participants
                  .filter(
                    (p) =>
                      p.rotationId === job._id && !p.acknowledged && !p.retired,
                  )
                  .map((p) => p.instanceId)
                  .join(", ") || "No missing acknowledgements"}
              </p>
              <button
                disabled={
                  !canRotate ||
                  workloadOnly ||
                  job.state !== "prepared" ||
                  rotationStatus.participants.some(
                    (p) =>
                      p.rotationId === job._id && !p.acknowledged && !p.retired,
                  )
                }
                onClick={() =>
                  void action(() =>
                    call("rotations/" + job._id + "/activate", "POST"),
                  )
                }
              >
                Activate acknowledged version
              </button>
            </div>
          ))}
          <p>
            Index/control keys and captured Clerk keys require verified
            application-side migration or a coordinated maintenance window.
          </p>
        </section>
      )}
      <button
        disabled={
          disabled || workloadOnly || resource.kind === "encryption-key"
        }
        onClick={() => {
          const confirmation = window.prompt(
            `Delete ${resource.name}? Type its name. Deletion is blocked while linked.`,
          );
          if (confirmation === resource.name)
            void action(() =>
              call("resources/" + resource._id, "DELETE", {
                revision: resource.revision,
                confirmation,
              }),
            );
        }}
      >
        Delete unused resource
      </button>
    </div>
  );
}
