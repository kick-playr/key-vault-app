import { DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import React, { useEffect, useRef, useState } from "react";
import { parseVersions } from "../lib/azure-vault";
interface Props {
  connection: { environment: string; tenant: string; token: string };
  name: string;
  version: string;
  onUnauthorized: () => void;
  compact?: boolean;
  copyLabel?: string;
}
export function SecretVersionValue({
  connection,
  name,
  version,
  onUnauthorized,
  compact = false,
  copyLabel = "Copy secret value",
}: Props) {
  const [value, setValue] = useState<string>(),
    [loading, setLoading] = useState(false),
    [copying, setCopying] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    request = useRef<AbortController | null>(null),
    alive = useRef(true);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identity = JSON.stringify([
    connection.environment,
    connection.tenant,
    name,
    version,
  ]);
  function clearCopied() {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = null;
    setCopied(false);
  }
  function hide() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setValue(undefined);
    setLoading(false);
    setCopying(false);
    clearCopied();
    setError("");
  }
  useEffect(() => {
    alive.current = true;
    hide();
    const clear = () => hide();
    window.addEventListener("pagehide", clear);
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
      generation.current++;
      request.current?.abort();
      window.removeEventListener("pagehide", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [identity, connection.token]);
  async function readSecret(
    current: number,
    controller: AbortController,
  ): Promise<string> {
    const response = await fetch(
      `/api/vault/secrets/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      {
        headers: {
          "x-vault-token": connection.token,
          "x-vault-environment": connection.environment,
          "x-vault-tenant": connection.tenant,
        },
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      },
    );
    if (!alive.current || current !== generation.current)
      throw Error("Cancelled");
    if (response.status === 401) onUnauthorized();
    if (!response.ok) throw Error("Read denied");
    const payload: unknown = await response.json();
    if (!alive.current || current !== generation.current)
      throw Error("Cancelled");
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw Error("Invalid response");
    const metadata = parseVersions(
      { value: [payload] },
      "secrets",
      connection,
      name,
    );
    const secret = (payload as { value?: unknown }).value;
    if (
      metadata[0]?.version !== version ||
      typeof secret !== "string" ||
      new TextEncoder().encode(secret).length > 25600
    )
      throw Error("Invalid response");
    return secret;
  }
  async function show() {
    hide();
    const current = generation.current,
      controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const secret = await readSecret(current, controller);
      if (alive.current && current === generation.current) setValue(secret);
    } catch {
      if (alive.current && current === generation.current)
        setError(
          "Unable to read this version. Check read permission, enabled status and validity dates.",
        );
    } finally {
      if (alive.current && current === generation.current) setLoading(false);
    }
  }
  async function copy() {
    if (loading) return;
    const current = ++generation.current,
      controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    clearCopied();
    setError("");
    setLoading(true);
    setCopying(true);
    try {
      const clipboard = navigator.clipboard;
      const canWriteItem =
        typeof clipboard?.write === "function" &&
        typeof ClipboardItem !== "undefined";
      if (
        !clipboard ||
        (typeof clipboard.writeText !== "function" && !canWriteItem)
      )
        throw Error("Clipboard unavailable");
      const secret =
        value === undefined
          ? readSecret(current, controller)
          : Promise.resolve(value);
      // ClipboardItem starts the browser clipboard operation inside the click gesture,
      // while the scoped read resolves. Never put a hidden copy in displayed state.
      void secret.catch(() => {});
      if (
        canWriteItem &&
        (value === undefined || typeof clipboard.writeText !== "function")
      ) {
        const blob = secret.then((text) => {
          if (!alive.current || current !== generation.current)
            throw Error("Cancelled");
          return new Blob([text], { type: "text/plain" });
        });
        void blob.catch(() => {});
        const item = new ClipboardItem({ "text/plain": blob });
        await clipboard.write([item]);
      } else {
        const text = await secret;
        if (!alive.current || current !== generation.current) return;
        await clipboard.writeText(text);
      }
      if (alive.current && current === generation.current) {
        setCopied(true);
        copiedTimer.current = setTimeout(() => {
          copiedTimer.current = null;
          if (alive.current && current === generation.current) setCopied(false);
        }, 3000);
      }
    } catch {
      controller.abort();
      if (alive.current && current === generation.current)
        setError(
          "Could not copy this version. Check read permission, validity dates and clipboard permission. You can also Show and select the value manually.",
        );
    } finally {
      if (alive.current && current === generation.current) {
        setLoading(false);
        setCopying(false);
      }
    }
  }
  return (
    <div
      className={
        compact
          ? "secret-version-value secret-copy-inline"
          : "secret-version-value"
      }
    >
      <div className="azure-toolbar">
        {!compact && (
          <button
            type="button"
            disabled={loading && value === undefined}
            onClick={() => (value === undefined ? void show() : hide())}
            aria-expanded={value !== undefined}
          >
            {loading && !copying
              ? "Reading…"
              : value === undefined
                ? "Show secret value"
                : "Hide secret value"}
          </button>
        )}
        <button
          type="button"
          className="secret-copy-button"
          aria-label={copyLabel}
          disabled={loading}
          onClick={() => void copy()}
        >
          {copying ? (
            "Copying…"
          ) : copied ? (
            "Copied"
          ) : (
            <DocumentDuplicateIcon aria-hidden="true" />
          )}
        </button>
      </div>
      {!compact && (
        <label className="field">
          Selected version secret value
          {value === undefined ? (
            <input
              type="password"
              readOnly
              value="••••••••"
              autoComplete="off"
            />
          ) : (
            <textarea readOnly value={value} rows={3} spellCheck={false} />
          )}
        </label>
      )}
      {copied && (
        <p role="status" className="sr-only">
          Secret value copied to clipboard.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
