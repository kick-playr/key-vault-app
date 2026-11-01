"use client";
import React, { useState } from "react";
import { buildOperation, type Fields, type Operation } from "../lib/operations";
export function OperationForm({
  operation,
  name,
  version,
  onRun,
  busy,
}: {
  operation: Operation;
  name: string;
  version: string;
  onRun: (fields: Fields) => Promise<void>;
  busy: boolean;
}) {
  const [validation, setValidation] = useState("");
  const id = operation.id;
  const advanced = operation.section === "advanced";
  const create = id === "key-create" || id === "secret-set";
  const update = id.endsWith("-update");
  const crypto = id === "encrypt" || id === "decrypt";
  const destructive = id.endsWith("-delete");
  const field = (
    key: string,
    label: string,
    options: {
      type?: string;
      required?: boolean;
      placeholder?: string;
      defaultValue?: string;
    } = {},
  ) => (
    <label className="field" key={key}>
      {label}
      <input
        name={key}
        type={options.type ?? "text"}
        required={options.required}
        placeholder={options.placeholder}
        defaultValue={options.defaultValue}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
  return (
    <form
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = Object.fromEntries(
          new FormData(form).entries(),
        ) as Fields;
        try {
          buildOperation(id, values);
          setValidation("");
        } catch (error) {
          setValidation(
            error instanceof Error ? error.message : "Check the form.",
          );
          return;
        }
        // Clear sensitive DOM fields as soon as their values have been captured.
        for (const input of Array.from(
          form.querySelectorAll<HTMLInputElement>('input[type="password"]'),
        ))
          input.value = "";
        await onRun(values);
      }}
    >
      <fieldset disabled={busy} className="operation-fields">
        {!advanced &&
          field("name", "Resource name", {
            required: true,
            defaultValue: name,
            placeholder: "e.g. data-encryption",
          })}
        {id.endsWith("-read") &&
          field("exactVersion", "Version (optional)", {
            placeholder: "Leave empty for latest",
            defaultValue: version,
          })}
        {(update || crypto) &&
          field("version", "Exact version", {
            required: true,
            placeholder: "Version identifier",
            defaultValue: version,
          })}
        {id === "key-create" && (
          <label className="field">
            RSA key size
            <select name="keySize" defaultValue="2048">
              <option value="2048">2048 bits</option>
              <option value="3072">3072 bits</option>
            </select>
          </label>
        )}
        {(id === "secret-set" || crypto) &&
          field("value", crypto ? "Base64url value" : "Secret value", {
            type: "password",
            required: id === "decrypt",
            placeholder: crypto ? "Unpadded base64url" : "Value stays masked",
          })}
        {(create || update) && (
          <>
            <div className="field-grid">
              <label className="field">
                Enabled status
                <select name="enabled" defaultValue="">
                  <option value="">
                    {create ? "API default" : "Keep unchanged"}
                  </option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              {operation.section === "keys" && (
                <label className="field">
                  Key operations
                  <select name="keyOps" defaultValue="">
                    <option value="">
                      {create ? "API default" : "Keep unchanged"}
                    </option>
                    <option value="encrypt,decrypt">Encrypt and decrypt</option>
                    <option value="encrypt">Encrypt only</option>
                    <option value="decrypt">Decrypt only</option>
                  </select>
                </label>
              )}
              {field("nbf", "Not before (epoch seconds)", {
                type: "number",
                placeholder: "Optional",
              })}
              {field("exp", "Expires (epoch seconds)", {
                type: "number",
                placeholder: "Optional",
              })}
            </div>
            {operation.section === "secrets" && (
              <>
                {field("contentType", "Content type", {
                  placeholder: "e.g. text/plain",
                })}
                {update && (
                  <label className="checkbox-field">
                    <input type="checkbox" name="clearContentType" />
                    Clear content type
                  </label>
                )}
              </>
            )}
            <label className="field">
              Tags (JSON object)
              <textarea
                name="tags"
                rows={2}
                placeholder={'{"owner":"platform"}'}
                spellCheck={false}
              />
            </label>
          </>
        )}
        {advanced && (
          <>
            <label className="field">
              Manifest (JSON)
              <textarea
                name="manifest"
                required
                rows={8}
                defaultValue={JSON.stringify(
                  {
                    schemaVersion: 1,
                    entries: [
                      {
                        purpose: "data-encryption",
                        kind: "key",
                        scope: "tenant",
                        envName: "APP_DATA_KEY_ID",
                        kty: "RSA",
                        keySize: 2048,
                        keyOps: ["encrypt", "decrypt"],
                      },
                    ],
                  },
                  null,
                  2,
                )}
                spellCheck={false}
              />
            </label>
            {id === "reconcile" && (
              <>
                {field("revision", "Configuration revision", {
                  type: "number",
                  required: true,
                  placeholder: "Monotonically increasing integer",
                })}
                {field("suppliedSecrets", "Supplied secrets (JSON object)", {
                  type: "password",
                  placeholder:
                    "Purpose → secret value; omitted values are reused",
                })}
              </>
            )}
          </>
        )}
        {destructive && (
          <div className="danger-box">
            <strong>This cannot be undone.</strong>
            <p>{operation.description}</p>
            {field("confirmation", "Type resource name to confirm", {
              required: true,
              placeholder: name || "Exact resource name",
            })}
          </div>
        )}
        {validation && (
          <p role="alert" className="error">
            {validation}
          </p>
        )}
        <button
          type="submit"
          className={destructive ? "button danger" : "button primary"}
          aria-label={`Run ${operation.label}`}
        >
          {busy ? "Working…" : operation.label}
          <span aria-hidden="true"> →</span>
        </button>
        <p className="form-note">
          Required vault permission: <code>{operation.permission}</code>. The
          API checks every request.
        </p>
      </fieldset>
    </form>
  );
}
