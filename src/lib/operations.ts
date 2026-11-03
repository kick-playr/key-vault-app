import { parseSecretValueFormat } from './secret-value-format';
export type Section = "keys" | "secrets" | "advanced";
export type Fields = Record<string, string>;
export interface Operation {
  id: string;
  label: string;
  section: Section;
  permission: string;
  description: string;
}
export const operations: Operation[] = [
  {
    id: "key-read",
    label: "Open key",
    section: "keys",
    permission: "read",
    description: "Read the public JWK of the latest or an exact key version.",
  },
  {
    id: "key-versions",
    label: "Versions",
    section: "keys",
    permission: "read",
    description: "List every version of this key.",
  },
  {
    id: "key-create",
    label: "Create / rotate",
    section: "keys",
    permission: "write",
    description:
      "Generate an RSA key. An existing name creates a new version; older versions remain usable.",
  },
  {
    id: "key-update",
    label: "Edit metadata",
    section: "keys",
    permission: "write",
    description:
      "Update one exact version. Disabling a key revokes access to that version.",
  },
  {
    id: "encrypt",
    label: "Encrypt",
    section: "keys",
    permission: "crypto",
    description:
      "Encrypt a single base64url-encoded block using RSA-OAEP-256. Use an explicit key version.",
  },
  {
    id: "decrypt",
    label: "Decrypt",
    section: "keys",
    permission: "crypto",
    description:
      "Decrypt base64url ciphertext with the exact key version used for encryption.",
  },
  {
    id: "key-delete",
    label: "Delete key",
    section: "keys",
    permission: "write",
    description:
      "Permanently delete ALL versions. Existing encrypted data may become unrecoverable. Reconciliation cannot automatically recreate this purpose.",
  },
  {
    id: "secret-read",
    label: "Open secret",
    section: "secrets",
    permission: "read",
    description:
      "Read the latest or an exact secret version. Values stay masked until you reveal them.",
  },
  {
    id: "secret-versions",
    label: "Versions",
    section: "secrets",
    permission: "read",
    description: "List secret version metadata without secret values.",
  },
  {
    id: "secret-set",
    label: "Set / rotate",
    section: "secrets",
    permission: "write",
    description:
      "Store a secret and create a new version. Older versions are retained.",
  },
  {
    id: "secret-update",
    label: "Edit metadata",
    section: "secrets",
    permission: "write",
    description:
      "Update enabled status, validity, tags or content type without reading or changing the secret value.",
  },
  {
    id: "secret-delete",
    label: "Delete secret",
    section: "secrets",
    permission: "write",
    description:
      "Permanently delete ALL versions of this secret. There is no recovery. Reconciliation cannot automatically recreate this purpose.",
  },
  {
    id: "reconcile",
    label: "Reconcile manifest",
    section: "advanced",
    permission: "read + write",
    description:
      "Provision manifest entries atomically. Supply a stable revision and payload on retries. Supplied secrets are sensitive.",
  },
  {
    id: "snapshot",
    label: "Runtime snapshot",
    section: "advanced",
    permission: "read",
    description:
      "Validate a manifest and retrieve its complete runtime mappings. Results may contain plaintext secrets.",
  },
];
function object(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error(`${label} must be valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}
function integer(text: string, label: string): number {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw Error(`${label} must be a non-negative integer.`);
  return Number(text);
}
export function buildOperation(
  id: string,
  fields: Fields,
): { method: string; path: string; body?: Record<string, unknown> } {
  const op = operations.find((op) => op.id === id);
  if (!op) throw Error("Choose a supported operation.");
  if (op.section === "advanced") {
    const manifest = object(fields.manifest ?? "", "Manifest");
    if (
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.entries) ||
      manifest.entries.length < 1 ||
      manifest.entries.length > 100
    )
      throw Error("Manifest requires schemaVersion 1 and 1–100 entries.");
    if (id === "snapshot")
      return { method: "POST", path: "local/snapshot", body: { manifest } };
    const revision = integer(fields.revision ?? "", "Revision");
    if (revision < 1) throw Error("Revision must be at least 1.");
    const secrets = fields.suppliedSecrets
      ? object(fields.suppliedSecrets, "Supplied secrets")
      : undefined;
    if (secrets && Object.values(secrets).some((v) => typeof v !== "string"))
      throw Error("Supplied secrets must map purposes to strings.");
    return {
      method: "POST",
      path: "local/reconcile",
      body: { manifest, revision, ...(secrets ? { secrets } : {}) },
    };
  }
  const name = fields.name ?? "";
  if (!/^[A-Za-z0-9-]{1,127}$/.test(name))
    throw Error("Name must contain 1–127 letters, digits or hyphens.");
  const prefix = `${op.section}/${name}`;
  if (id.endsWith("-read")) {
    const version = fields.exactVersion;
    if (version && !/^[A-Za-z0-9-]{1,128}$/.test(version))
      throw Error("Invalid version.");
    return { method: "GET", path: prefix + (version ? "/" + version : "") };
  }
  if (id.endsWith("-versions"))
    return { method: "GET", path: prefix + "/versions" };
  if (id.endsWith("-delete")) {
    if (fields.confirmation !== name)
      throw Error("Type the resource name to confirm permanent deletion.");
    return { method: "DELETE", path: prefix };
  }
  let version = "";
  if (id.endsWith("-update") || id === "encrypt" || id === "decrypt") {
    version = fields.version ?? "";
    if (!/^[A-Za-z0-9-]{1,128}$/.test(version))
      throw Error("An exact version is required.");
  }
  if (id === "encrypt" || id === "decrypt") {
    const value = fields.value ?? "";
    if (
      !/^[A-Za-z0-9_-]*$/.test(value) ||
      value.length > 8192 ||
      value.length % 4 === 1
    )
      throw Error(
        "Value must be unpadded base64url (at most 8192 characters).",
      );
    const canonical = btoa(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    if (canonical !== value)
      throw Error("Value must use canonical unpadded base64url.");
    return {
      method: "POST",
      path: `${prefix}/${version}/${id}`,
      body: { alg: "RSA-OAEP-256", value },
    };
  }
  const body: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  if (fields.enabled) {
    if (!["true", "false"].includes(fields.enabled))
      throw Error("Invalid enabled status.");
    attributes.enabled = fields.enabled === "true";
  }
  for (const key of ["nbf", "exp"])
    if (fields[key]) attributes[key] = integer(fields[key], key);
  if (
    typeof attributes.nbf === "number" &&
    typeof attributes.exp === "number" &&
    attributes.nbf >= attributes.exp
  )
    throw Error("Not before must precede expiry.");
  if (Object.keys(attributes).length) body.attributes = attributes;
  if (fields.tags) {
    const tags = object(fields.tags, "Tags");
    if (
      Object.keys(tags).length > 15 ||
      Object.entries(tags).some(
        ([k, v]) => k.length > 512 || typeof v !== "string" || v.length > 512,
      )
    )
      throw Error(
        "Tags allow at most 15 string pairs, each up to 512 characters.",
      );
    body.tags = tags;
  }
  if (op.section === "keys" && fields.keyOps) {
    const keyOps = fields.keyOps.split(",");
    if (
      keyOps.some((v) => !["encrypt", "decrypt"].includes(v)) ||
      new Set(keyOps).size !== keyOps.length
    )
      throw Error("Key operations must be encrypt, decrypt or both.");
    body.key_ops = keyOps;
  }
  if (op.section === "secrets") {
    if (fields.valueFormat !== undefined) body.valueFormat = parseSecretValueFormat(fields.valueFormat);
    if ((fields.contentType?.length ?? 0) > 255)
      throw Error("Content type must be at most 255 characters.");
    if (fields.clearContentType === "on") body.contentType = "";
    else if (fields.contentType) body.contentType = fields.contentType;
  }
  if (id === "key-create") {
    const size = Number(fields.keySize || "2048");
    if (![2048, 3072].includes(size))
      throw Error("RSA size must be 2048 or 3072.");
    return {
      method: "POST",
      path: prefix + "/create",
      body: { kty: "RSA", key_size: size, ...body },
    };
  }
  if (id === "secret-set") {
    const value = fields.value ?? "";
    if (new TextEncoder().encode(value).length > 25 * 1024)
      throw Error("Secret exceeds 25 KiB.");
    return { method: "PUT", path: prefix, body: { value, ...body } };
  }
  return { method: "PATCH", path: `${prefix}/${version}`, body };
}
