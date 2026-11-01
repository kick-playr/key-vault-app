export type InventoryEndpoint = "keys" | "secrets" | "local/inventory";
export interface VaultScope {
  environment: string;
  tenant: string;
}
export interface InventoryRow {
  name: string;
  kind: "key" | "secret";
  version: string;
  enabled: boolean;
  expires?: number;
  activation?: number;
  updated?: number;
  purpose?: string;
  tags?: Record<string, string>;
  contentType?: string;
}
const common = ["maxresults", "$skiptoken"];
const filters = [
  "kind",
  "name",
  "namePrefix",
  "purpose",
  "enabled",
  "expiresBefore",
  "tagName",
  "tagValue",
];
export function inventoryQuery(
  fields: Record<string, string>,
  local: boolean,
): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (![...common, ...(local ? filters : [])].includes(key))
      throw Error("Unsupported inventory parameter.");
    if (value !== "" || (key === "tagValue" && !!fields.tagName))
      query.set(key, value);
  }
  const max = query.get("maxresults");
  if (max !== null && !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(max))
    throw Error("Page size must be 1–25.");
  const cursor = query.get("$skiptoken");
  if (
    cursor !== null &&
    (cursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor))
  )
    throw Error("Invalid continuation token.");
  if (local) {
    if (query.has("kind") && !["key", "secret"].includes(query.get("kind")!))
      throw Error("Invalid kind.");
    for (const key of ["name", "namePrefix", "purpose"])
      if (query.has(key) && !/^[A-Za-z0-9-]{1,127}$/.test(query.get(key)!))
        throw Error(
          "Names, prefixes and purposes allow letters, digits and hyphens (1–127 characters).",
        );
    if (
      query.has("enabled") &&
      !["true", "false"].includes(query.get("enabled")!)
    )
      throw Error("Invalid enabled filter.");
    const expires = query.get("expiresBefore");
    if (
      expires !== null &&
      (!/^\d+$/.test(expires) || !Number.isSafeInteger(Number(expires)))
    )
      throw Error("Expiry must be non-negative epoch seconds.");
    if (
      query.has("tagName") !== query.has("tagValue") ||
      (query.has("tagName") &&
        (query.get("tagName")!.length > 512 ||
          query.get("tagValue")!.length > 512))
    )
      throw Error(
        "Specify both tag name and value, up to 512 characters each.",
      );
  }
  return query;
}
function loopbackUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error("Invalid vault link.");
  return url;
}
export function continuationPath(
  link: string,
  endpoint: InventoryEndpoint,
  scope: VaultScope,
): string {
  const url = loopbackUrl(link);
  if (
    url.pathname !==
    `/namespaces/${scope.environment}/${scope.tenant}/${endpoint}`
  )
    throw Error("Continuation belongs to a different namespace or inventory.");
  const fields: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(fields, key))
      throw Error("Duplicate inventory parameter.");
    fields[key] = value;
  }
  if (endpoint !== "local/inventory") {
    if (fields["api-version"] !== "2025-07-01")
      throw Error("Unsupported API version.");
    delete fields["api-version"];
  }
  if (!fields.$skiptoken) throw Error("Missing continuation token.");
  return (
    endpoint +
    "?" +
    inventoryQuery(fields, endpoint === "local/inventory").toString()
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid inventory response.");
  return value as Record<string, unknown>;
}
export function parseInventory(
  value: unknown,
  endpoint: InventoryEndpoint,
  scope: VaultScope,
): { rows: InventoryRow[]; nextLink: string | undefined } {
  const page = record(value);
  if (!Array.isArray(page.value) || page.value.length > 25)
    throw Error("Invalid inventory response.");
  const rows = page.value.map<InventoryRow>((raw) => {
    const item = record(raw);
    const kind =
      endpoint === "keys"
        ? "key"
        : endpoint === "secrets"
          ? "secret"
          : item.kind;
    if (kind !== "key" && kind !== "secret")
      throw Error("Invalid resource kind.");
    const id = kind === "key" && endpoint === "keys" ? item.kid : item.id;
    if (typeof id !== "string") throw Error("Missing inventory identifier.");
    const url = loopbackUrl(id);
    const prefix = `/namespaces/${scope.environment}/${scope.tenant}/${kind === "key" ? "keys" : "secrets"}/`;
    if (!url.pathname.startsWith(prefix) || url.search)
      throw Error("Inventory belongs to a different namespace.");
    const name = url.pathname.slice(prefix.length);
    if (!/^[A-Za-z0-9-]{1,127}$/.test(name))
      throw Error("Invalid inventory name.");
    const attributes = record(item.attributes);
    if (typeof attributes.enabled !== "boolean")
      throw Error("Invalid inventory status.");
    let version = "";
    if (endpoint === "local/inventory") {
      if (
        item.name !== name ||
        typeof item.version !== "string" ||
        !/^[A-Za-z0-9-]{1,128}$/.test(item.version) ||
        typeof item.versionId !== "string"
      )
        throw Error("Invalid inventory version.");
      const versionId = loopbackUrl(item.versionId);
      if (
        versionId.pathname !== url.pathname + "/" + item.version ||
        versionId.search
      )
        throw Error("Invalid inventory version.");
      version = item.version;
    }
    let tags: Record<string, string> | undefined;
    if (item.tags !== undefined) {
      const candidate = record(item.tags);
      if (Object.values(candidate).some((v) => typeof v !== "string"))
        throw Error("Invalid inventory tags.");
      tags = candidate as Record<string, string>;
    }
    const expires = attributes.exp;
    if (
      expires !== undefined &&
      (!Number.isSafeInteger(expires) || (expires as number) < 0)
    )
      throw Error("Invalid inventory expiry.");
    const purpose =
      typeof item.purpose === "string" ? item.purpose : tags?.purpose;
    return {
      kind,
      name,
      version,
      enabled: attributes.enabled,
      ...(expires !== undefined ? { expires: expires as number } : {}),
      ...(Number.isSafeInteger(attributes.nbf) &&
      (attributes.nbf as number) >= 0
        ? { activation: attributes.nbf as number }
        : {}),
      ...(Number.isSafeInteger(attributes.updated) &&
      (attributes.updated as number) >= 0
        ? { updated: attributes.updated as number }
        : {}),
      ...(purpose !== undefined ? { purpose } : {}),
      ...(tags ? { tags } : {}),
      ...(typeof item.contentType === "string"
        ? { contentType: item.contentType }
        : {}),
    };
  });
  if (page.nextLink !== undefined) {
    if (typeof page.nextLink !== "string")
      throw Error("Invalid continuation link.");
    continuationPath(page.nextLink, endpoint, scope);
  }
  return { rows, nextLink: page.nextLink as string | undefined };
}
