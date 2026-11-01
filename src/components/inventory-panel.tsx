"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import {
  inventoryQuery,
  continuationPath,
  parseInventory,
  type InventoryEndpoint,
  type InventoryRow,
} from "../lib/inventory";
import type { Section } from "../lib/operations";
export function InventoryPanel({
  connection,
  section,
  revision,
  onSelect,
}: {
  connection: { environment: string; tenant: string; token: string };
  section: Section;
  revision: number;
  onSelect: (row: InventoryRow) => void;
}) {
  const [source, setSource] = useState(
    section === "advanced" ? "search" : "list",
  );
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [next, setNext] = useState<string>();
  const [endpoint, setEndpoint] = useState<InventoryEndpoint>(
    section === "advanced" ? "local/inventory" : section,
  );
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const firstPage = useRef<{
    path: string;
    endpoint: InventoryEndpoint;
  } | null>(null);
  const status = useRef<HTMLDivElement>(null);
  function invalidate() {
    generation.current++;
    request.current?.abort();
    setRows([]);
    setNext(undefined);
    setError("");
    setNotice("");
    setLoaded(false);
    setBusy(false);
    setPage(1);
    firstPage.current = null;
  }
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );
  // Writes invalidate API cursors. Refresh from the first page of the applied query.
  useEffect(() => {
    const first = firstPage.current;
    if (first) void load(first.path, first.endpoint, 1);
  }, [revision]);
  async function load(
    path: string,
    which: InventoryEndpoint,
    pageNumber: number,
  ) {
    generation.current++;
    const current = generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setRows([]);
    setNext(undefined);
    setEndpoint(which);
    try {
      const response = await fetch("/api/vault/" + path, {
        headers: {
          "x-vault-token": connection.token,
          "x-vault-environment": connection.environment,
          "x-vault-tenant": connection.tenant,
        },
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (current !== generation.current) return;
      if (!response.ok) {
        if (response.status === 403)
          throw Error(
            "Inventory needs the separate list permission for this namespace. Read, write and crypto do not imply list. You can still use open-by-name below with an appropriate grant.",
          );
        if (response.status === 401)
          throw Error(
            "Sign-in or vault token is invalid. Reconnect before listing.",
          );
        if (response.status === 409)
          throw Error(
            "The vault changed while paging. Reload inventory to start a fresh snapshot.",
          );
        if (response.status === 400 && pageNumber > 1)
          throw Error(
            "The continuation token expired or is invalid. Reload inventory from the first page.",
          );
        throw Error(
          "Inventory is unavailable. Check the provider and reload inventory.",
        );
      }
      const data = await response.json();
      if (current !== generation.current) return;
      const parsed = parseInventory(data, which, connection);
      setRows(parsed.rows);
      setNext(parsed.nextLink);
      setPage(pageNumber);
      setLoaded(true);
      setNotice(`${parsed.rows.length} metadata rows on page ${pageNumber}.`);
    } catch (e) {
      if (current === generation.current && !controller.signal.aborted) {
        setLoaded(false);
        setError(
          e instanceof Error &&
            !(e instanceof TypeError) &&
            !(e instanceof DOMException)
            ? e.message
            : "Inventory is unavailable. Check the provider and reload inventory.",
        );
      }
    } finally {
      if (current === generation.current) {
        setBusy(false);
        request.current = null;
        status.current?.focus();
      }
    }
  }
  function submit(form: HTMLFormElement) {
    try {
      const input = Object.fromEntries(new FormData(form).entries()) as Record<
        string,
        string
      >;
      const which: InventoryEndpoint =
        source === "search"
          ? "local/inventory"
          : section === "secrets"
            ? "secrets"
            : "keys";
      if (source === "search" && section !== "advanced")
        input.kind = section === "keys" ? "key" : "secret";
      const query = inventoryQuery(input, which === "local/inventory");
      const path = which + (query.size ? "?" + query.toString() : "");
      firstPage.current = { path, endpoint: which };
      void load(path, which, 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check inventory filters.");
    }
  }
  return (
    <section
      className="panel inventory-panel"
      aria-labelledby="inventory-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NAMESPACE METADATA</p>
          <h2 id="inventory-title">
            {section === "advanced"
              ? "Combined inventory"
              : section === "keys"
                ? "Key inventory"
                : "Secret inventory"}
          </h2>
          <p>
            Latest non-deleted resources, including disabled and expired
            versions. Requires <code>list</code>; values and key material are
            excluded.
          </p>
        </div>
        <span className="permission-badge">list</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(event.currentTarget);
        }}
        onChange={invalidate}
      >
        <div className="inventory-toolbar">
          <label className="field">
            Inventory source
            <select
              value={source}
              onChange={(event) => {
                invalidate();
                setSource(event.target.value);
              }}
            >
              {section !== "advanced" && (
                <option value="list">Resource list</option>
              )}
              <option value="search">Filtered inventory</option>
            </select>
          </label>
          <label className="field">
            Page size
            <input
              name="maxresults"
              type="number"
              min="1"
              max="25"
              step="1"
              required
              defaultValue="25"
            />
          </label>
        </div>
        {source === "search" && (
          <div className="inventory-filters">
            {section === "advanced" && (
              <label className="field">
                Resource kind
                <select name="kind" defaultValue="">
                  <option value="">Keys and secrets</option>
                  <option value="key">Keys</option>
                  <option value="secret">Secrets</option>
                </select>
              </label>
            )}
            {(
              [
                ["name", "Exact name"],
                ["namePrefix", "Name prefix"],
                ["purpose", "Purpose"],
              ] as const
            ).map(([name, label]) => (
              <label className="field" key={name}>
                {label}
                <input name={name} autoComplete="off" placeholder="Optional" />
              </label>
            ))}
            <label className="field">
              Enabled filter
              <select name="enabled" defaultValue="">
                <option value="">Any status</option>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </label>
            <label className="field">
              Expires at / before (epoch seconds)
              <input
                name="expiresBefore"
                type="number"
                min="0"
                placeholder="Optional"
              />
            </label>
            <label className="field">
              Tag name
              <input
                name="tagName"
                autoComplete="off"
                placeholder="e.g. owner"
              />
            </label>
            <label className="field">
              Tag value
              <input
                name="tagValue"
                autoComplete="off"
                placeholder="Exact value (can be empty)"
              />
            </label>
          </div>
        )}
        <div className="inventory-actions">
          <button className="button secondary" type="submit" disabled={busy}>
            {source === "search" ? <MagnifyingGlassIcon /> : <ArrowPathIcon />}
            {loaded || error ? "Reload inventory" : "Load inventory"}
          </button>
          <span className="form-note">
            Search stays inside {connection.environment} / {connection.tenant}.
            Filters are metadata, not secret values.
          </span>
        </div>
      </form>
      <div
        ref={status}
        tabIndex={-1}
        aria-live="polite"
        className="inventory-status"
      >
        {busy && <p role="status">Loading inventory…</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p>{notice}</p>}
        {!loaded && !busy && !error && (
          <p>Load the inventory to discover resources in this namespace.</p>
        )}
      </div>
      {loaded && rows.length === 0 && (
        <p className="inventory-empty">No resources match these filters.</p>
      )}
      {rows.length > 0 && (
        <div className="inventory-table-scroll">
          <table>
            <caption className="sr-only">
              Latest resource metadata in the current namespace
            </caption>
            <thead>
              <tr>
                <th scope="col">Resource</th>
                <th scope="col">Kind / status</th>
                <th scope="col">Metadata</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.kind + "/" + row.name}>
                  <td>
                    <strong>{row.name}</strong>
                    {row.version && <small>Version: {row.version}</small>}
                  </td>
                  <td>
                    <span className="inventory-kind">{row.kind}</span>
                    <small>{row.enabled ? "Enabled" : "Disabled"}</small>
                    {row.expires !== undefined && (
                      <small>
                        {row.expires <= Date.now() / 1000
                          ? "Expired"
                          : "Expires"}
                        : {row.expires} (epoch)
                      </small>
                    )}
                  </td>
                  <td>
                    {row.purpose && <span>Purpose: {row.purpose}</span>}
                    {row.contentType && <small>{row.contentType}</small>}
                    {row.tags && (
                      <details>
                        <summary>Tags ({Object.keys(row.tags).length})</summary>
                        <pre>{JSON.stringify(row.tags, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      aria-label={"Select " + row.name}
                      onClick={() => onSelect(row)}
                    >
                      Select →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && !busy && (
        <div className="inventory-pagination">
          <span>Page {page} · More resources available</span>
          <button
            className="button secondary"
            onClick={() => {
              try {
                void load(
                  continuationPath(next, endpoint, connection),
                  endpoint,
                  page + 1,
                );
              } catch {
                invalidate();
                setError("Invalid continuation link. Reload inventory.");
              }
            }}
          >
            Next page
          </button>
        </div>
      )}
      <p className="form-note">
        Selecting metadata fills the operation form. Reading values and changing
        resources still require their own permissions.
      </p>
    </section>
  );
}
