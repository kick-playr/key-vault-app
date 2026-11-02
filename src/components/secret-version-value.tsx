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
  async function show() {
    hide();
    const current = generation.current,
      controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/vault/secrets/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
        {
          headers: {
            "x-vault-token": connection.token,
            "x-vault-environment": connection.environment,
            "x-vault-tenant": connection.tenant,
          },
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        },
      );
      if (!alive.current || current !== generation.current) return;
      if (response.status === 401) onUnauthorized();
      if (!response.ok) throw Error("Read denied");
      const payload: unknown = await response.json();
      if (!alive.current || current !== generation.current) return;
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
      setValue(secret);
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
    if (value === undefined) return;
    const current = generation.current;
    setMessage("");
    setError("");
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (alive.current && current === generation.current)
        setMessage("Copied. The clipboard retains the value until replaced.");
    } catch {
      if (alive.current && current === generation.current)
        setError(
          "Could not copy. Check clipboard permission or select the shown value manually.",
        );
    }
  }
  return (
    <div className="secret-version-value">
      <div className="azure-toolbar">
        <button
          type="button"
          disabled={loading}
          onClick={() => (value === undefined ? void show() : hide())}
          aria-expanded={value !== undefined}
        >
          {loading
            ? "Reading…"
            : value === undefined
              ? "Show secret value"
              : "Hide secret value"}
        </button>
        <button
          type="button"
          disabled={value === undefined || loading}
          onClick={() => void copy()}
        >
          Copy secret value
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
