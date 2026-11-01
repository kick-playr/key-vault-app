import React, { useRef, useState } from "react";
import { buildOperation, type Fields } from "../lib/operations";
import {
  decodeSecretFile,
  utcEpoch,
  type VaultVersion,
} from "../lib/azure-vault";
export type AzureMode =
  | "create-secret"
  | "new-version"
  | "edit-metadata"
  | "create-key";
export type VaultRequest = ReturnType<typeof buildOperation>;
interface Props {
  mode: AzureMode;
  name: string;
  selected?: VaultVersion;
  onSubmit: (request: VaultRequest) => Promise<boolean>;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}
const dateInput = (n?: number) =>
  n === undefined ? "" : new Date(n * 1000).toISOString().slice(0, 19);
export function AzureVaultForm({
  mode,
  name,
  selected,
  onSubmit,
  onCancel,
  onDirty,
}: Props) {
  const editing = mode === "edit-metadata",
    key = mode === "create-key";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [upload, setUpload] = useState("manual"),
    [value, setValue] = useState("");
  const [fileReady, setFileReady] = useState(false),
    [reading, setReading] = useState(false);
  const [nbf, setNbf] = useState(selected?.attributes.nbf !== undefined),
    [exp, setExp] = useState(selected?.attributes.exp !== undefined);
  const [tags, setTags] = useState<[string, string][]>(
    Object.entries(selected?.tags ?? {}),
  );
  const alive = useRef(true),
    fileSequence = useRef(0);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      fileSequence.current++;
    };
  }, []);
  const errorRef = useRef<HTMLParagraphElement>(null);
  function fail(message: string) {
    setError(message);
    queueMicrotask(() => errorRef.current?.focus());
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || reading) return;
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const fields: Fields = {
        name: String(data.get("name") ?? ""),
        enabled: String(data.get("enabled")),
        ...(editing ? { version: selected?.version ?? "" } : {}),
      };
      if (!editing && !key) {
        if (!value || (upload === "file" && !fileReady))
          throw Error("Enter a secret value or select a nonempty UTF-8 file.");
        fields.value = value;
      }
      for (const [field, checked] of [
        ["nbf", nbf],
        ["exp", exp],
      ] as const) {
        if (checked)
          fields[field] = String(utcEpoch(String(data.get(field) ?? "")));
        else if (editing && selected?.attributes[field] !== undefined)
          throw Error("Existing dates cannot be cleared by this API.");
      }
      if (!key) {
        fields.contentType = String(data.get("contentType") ?? "");
        if (editing && !fields.contentType) fields.clearContentType = "on";
      } else {
        fields.keySize = String(data.get("keySize"));
        const ops = data.getAll("keyOps").map(String);
        if (!ops.length) throw Error("Choose at least one key operation.");
        fields.keyOps = ops.join(",");
      }
      const pairs = tags.filter(([k, v]) => k !== "" || v !== "");
      if (
        pairs.some(([k]) => !k) ||
        new Set(pairs.map(([k]) => k)).size !== pairs.length
      )
        throw Error("Tag names must be nonempty and unique.");
      if (pairs.length || editing || selected?.tags)
        fields.tags = JSON.stringify(Object.fromEntries(pairs));
      const request = buildOperation(
        key ? "key-create" : editing ? "secret-update" : "secret-set",
        fields,
      );
      setBusy(true);
      const success = await onSubmit(request);
      if (alive.current && success) {
        setValue("");
        setFileReady(false);
        onDirty(false);
        form.reset();
      }
    } catch (e) {
      if (alive.current)
        fail(e instanceof Error ? e.message : "Check the form.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function importFile(file?: File) {
    const sequence = ++fileSequence.current;
    setValue("");
    setFileReady(false);
    setReading(false);
    setError("");
    if (!file) return;
    if (!file.size || file.size > 25600) {
      fail("Choose a nonempty UTF-8 file up to 25 KiB.");
      return;
    }
    setReading(true);
    try {
      const decoded = decodeSecretFile(
        new Uint8Array(await file.arrayBuffer()),
      );
      if (alive.current && sequence === fileSequence.current) {
        setValue(decoded);
        setFileReady(true);
      }
    } catch {
      if (alive.current && sequence === fileSequence.current)
        fail("Choose a valid UTF-8 text file up to 25 KiB.");
    } finally {
      if (alive.current && sequence === fileSequence.current) setReading(false);
    }
  }
  return (
    <form
      className="azure-form"
      onSubmit={submit}
      onChange={() => onDirty(true)}
    >
      <fieldset disabled={busy} className="azure-fields">
        <h2>
          {editing
            ? "Edit secret metadata"
            : mode === "new-version"
              ? "New secret version"
              : key
                ? "Generate encryption key"
                : "Create a secret"}
        </h2>
        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="error">
            {error}
          </p>
        )}
        <label className="field">
          Name
          <input
            name="name"
            required
            pattern="[A-Za-z0-9-]{1,127}"
            maxLength={127}
            defaultValue={name}
            readOnly={editing || mode === "new-version"}
            autoComplete="off"
            aria-describedby="azure-name-help"
          />
        </label>
        <p id="azure-name-help" className="muted">
          1–127 letters, digits or hyphens. An existing name creates another
          version.
        </p>
        {!editing && !key && (
          <>
            <label className="field">
              Upload options
              <select
                value={upload}
                onChange={(e) => {
                  setUpload(e.target.value);
                  setValue("");
                  setFileReady(false);
                  fileSequence.current++;
                  setReading(false);
                }}
              >
                <option value="manual">Manual</option>
                <option value="file">Import text file</option>
              </select>
            </label>
            {upload === "file" && (
              <>
                <label className="field">
                  UTF-8 text file
                  <input
                    type="file"
                    onChange={(e) => void importFile(e.target.files?.[0])}
                  />
                </label>
                <p className="muted">
                  One file up to 25 KiB. Content is preserved exactly. It is
                  sent only when you create the secret.
                </p>
                <p role="status">
                  {reading
                    ? "Reading file…"
                    : fileReady
                      ? "File ready. Value remains masked."
                      : "Choose a file."}
                </p>
              </>
            )}
            <label className="field">
              Secret value
              <input
                type="password"
                value={value}
                readOnly={upload === "file"}
                required
                autoComplete="new-password"
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          </>
        )}
        {key && (
          <>
            <p className="muted">
              RSA · RSA-OAEP-256. Private material stays on the server and
              cannot be exported through this API. A new version does not
              re-encrypt existing data.
            </p>
            <label className="field">
              RSA key size
              <select name="keySize" defaultValue="2048">
                <option value="2048">2048 bits</option>
                <option value="3072">3072 bits</option>
              </select>
            </label>
            <fieldset>
              <legend>Permitted operations</legend>
              <label>
                <input
                  type="checkbox"
                  name="keyOps"
                  value="encrypt"
                  defaultChecked
                />{" "}
                Encrypt
              </label>
              <label>
                <input
                  type="checkbox"
                  name="keyOps"
                  value="decrypt"
                  defaultChecked
                />{" "}
                Decrypt
              </label>
            </fieldset>
          </>
        )}
        {editing && (
          <p className="muted">
            Only this exact version’s metadata is saved. Concurrent saves can
            overwrite metadata. To change its value, use New version.
          </p>
        )}
        <label className="field">
          Enabled
          <select
            name="enabled"
            defaultValue={String(selected?.attributes.enabled ?? true)}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <details open={editing} className="azure-properties">
          <summary>Properties and tags (optional)</summary>
          {!key && (
            <label className="field">
              Content type
              <input
                name="contentType"
                maxLength={255}
                defaultValue={selected?.contentType ?? ""}
              />
            </label>
          )}
          {(["nbf", "exp"] as const).map((field) => {
            const checked = field === "nbf" ? nbf : exp;
            const label = field === "nbf" ? "Activation" : "Expiration";
            const locked = editing && selected?.attributes[field] !== undefined;
            return (
              <div key={field}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(e) =>
                      (field === "nbf" ? setNbf : setExp)(e.target.checked)
                    }
                  />{" "}
                  Set {label.toLowerCase()} date
                </label>
                {locked && (
                  <p className="muted">
                    Existing {label.toLowerCase()} date can be changed, but
                    cannot be cleared.
                  </p>
                )}
                {checked && (
                  <label className="field">
                    {label} date and time (UTC)
                    <input
                      type="datetime-local"
                      step="1"
                      name={field}
                      required
                      defaultValue={dateInput(selected?.attributes[field])}
                    />
                  </label>
                )}
              </div>
            );
          })}
          <p className="muted">
            All dates use UTC. Activation must precede expiration.
          </p>
          <fieldset>
            <legend>Tags</legend>
            {tags.map(([k, v], i) => (
              <div className="azure-tag" key={i}>
                <label className="field">
                  Tag name {i + 1}
                  <input
                    maxLength={512}
                    value={k}
                    onChange={(e) =>
                      setTags(
                        tags.map((p, j) =>
                          j === i ? [e.target.value, p[1]] : p,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field">
                  Tag value {i + 1}
                  <input
                    maxLength={512}
                    value={v}
                    onChange={(e) =>
                      setTags(
                        tags.map((p, j) =>
                          j === i ? [p[0], e.target.value] : p,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setTags(tags.filter((_, j) => j !== i));
                    onDirty(true);
                  }}
                >
                  Remove tag {i + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={tags.length >= 15}
              onClick={() => {
                setTags([...tags, ["", ""]]);
                onDirty(true);
              }}
            >
              Add tag
            </button>
          </fieldset>
        </details>
        <div className="azure-toolbar">
          <button type="submit" disabled={busy || reading}>
            {busy
              ? "Saving…"
              : editing
                ? "Save metadata"
                : key
                  ? "Create key"
                  : mode === "new-version"
                    ? "Create new version"
                    : "Create secret"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
