import React, { useEffect, useRef, useState } from "react";
import { parseVersions } from "../lib/azure-vault";
interface Props {
  connection: { environment: string; tenant: string; token: string };
  name: string;
  version: string;
  onUnauthorized: () => void;
}
export function SecretVersionValue({
  connection,
  name,
  version,
  onUnauthorized,
}: Props) {
  const [value, setValue] = useState<string>(),
    [loading, setLoading] = useState(false),
    [copying, setCopying] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const generation = useRef(0),
    request = useRef<AbortController | null>(null),
    alive = useRef(true);
  const identity = JSON.stringify([
    connection.environment,
    connection.tenant,
    name,
    version,
  ]);
  function hide() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setValue(undefined);
    setLoading(false);
    setCopying(false);
    setMessage("");
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
    setMessage("");
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
      if (alive.current && current === generation.current)
        setMessage("Copied. The clipboard retains the value until replaced.");
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
    <div className="secret-version-value">
      <div className="azure-toolbar">
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
        <button type="button" disabled={loading} onClick={() => void copy()}>
          {copying ? "Copying…" : "Copy secret value"}
        </button>
      </div>
      <label className="field">
        Selected version secret value
        {value === undefined ? (
          <input type="password" readOnly value="••••••••" autoComplete="off" />
        ) : (
          <textarea readOnly value={value} rows={3} spellCheck={false} />
        )}
      </label>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
