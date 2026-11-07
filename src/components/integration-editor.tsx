"use client";
import React, { useState } from "react";
export function IntegrationEditor({
  schema,
  onSave,
  disabled = false,
}: {
  schema: {
    properties?: Record<
      string,
      { type?: string; enum?: unknown[]; "x-secret"?: boolean }
    >;
    required?: string[];
  };
  onSave: (value: Record<string, unknown>) => Promise<void>;
  disabled?: boolean;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSave(values);
          setValues({});
        } catch {
          setError(
            "Could not save. Check the required fields and your tenant approval.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 12,
        }}
      >
        {Object.entries(schema.properties ?? {}).map(([name, field]) => (
          <label key={name}>
            {name}
            {schema.required?.includes(name) ? " *" : ""}
            {field.enum ? (
              <select
                disabled={disabled || busy}
                value={String(values[name] ?? "")}
                onChange={(e) =>
                  setValues({ ...values, [name]: e.target.value })
                }
              >
                <option value="">Choose…</option>
                {field.enum.map((v) => (
                  <option key={String(v)}>{String(v)}</option>
                ))}
              </select>
            ) : (
              <input
                autoComplete="off"
                required={schema.required?.includes(name)}
                disabled={disabled || busy}
                type={
                  field.type === "integer" || field.type === "number"
                    ? "number"
                    : field["x-secret"] || /secret|password|token/i.test(name)
                      ? "password"
                      : "text"
                }
                value={String(values[name] ?? "")}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [name]:
                      field.type === "integer" || field.type === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button disabled={disabled || busy} type="submit">
        {busy ? "Saving…" : "Save integration"}
      </button>
    </form>
  );
}
