import { inventoryQuery } from "./inventory";
/** Server boundary. No credentials, bodies or upstream messages are logged. */
export interface ProxyOptions {
  userId: string | null;
  upstream: string;
  fetch?: typeof fetch;
}
const MAX_REQUEST = 128 * 1024;
const MAX_RESPONSE = 1024 * 1024;
const scopePattern = /^[A-Za-z0-9_-]{1,64}$/;
const namePattern = /^[A-Za-z0-9-]{1,127}$/;
const versionPattern = /^[A-Za-z0-9-]{1,128}$/;
const safeHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function failure(status: number, code: string) {
  return Response.json(
    { error: { code, message: code } },
    { status, headers: safeHeaders },
  );
}
export function supportedRoute(method: string, path: string[]) {
  const [kind, name, version, action] = path;
  if (
    kind === "local" &&
    path.length === 2 &&
    ["inventory", "session"].includes(name ?? "")
  )
    return method === "GET";
  if (["keys", "secrets"].includes(kind ?? "") && path.length === 1)
    return method === "GET";
  if (kind === "local" && name === "runtime-configuration") {
    if (path.length === 2) return ["GET", "PUT"].includes(method);
    if (path.length === 3 && version === "import") return method === "POST";
    return (
      path.length === 4 &&
      version === "tenants" &&
      scopePattern.test(action ?? "") &&
      action !== "_shared" &&
      method === "GET"
    );
  }
  if (kind === "local" && name === "runtime-access-control") {
    return (
      path.length === 5 &&
      /^[a-z][a-z0-9-]{0,63}$/.test(version ?? "") &&
      action === "tenants" &&
      scopePattern.test(path[4] ?? "") &&
      path[4] !== "_shared" &&
      ["GET", "PUT"].includes(method)
    );
  }
  if (kind === "local" && name === "applications") {
    if (path.length === 2) return method === "GET";
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(version ?? "")) return false;
    if (path.length === 3) return ["PUT", "DELETE"].includes(method);
    if (path.length === 4 && ["status", "usage"].includes(action ?? ""))
      return method === "GET";
    if (path.length === 4 && action === "resources") return method === "PUT";
    if (path.length === 4 && action === "activate") return method === "PUT";
    return (
      path.length === 6 &&
      action === "resources" &&
      ["keys", "secrets"].includes(path[4] ?? "") &&
      namePattern.test(path[5] ?? "") &&
      ["PUT", "DELETE"].includes(method)
    );
  }
  if (kind === "local")
    return (
      path.length === 2 &&
      method === "POST" &&
      ["reconcile", "snapshot"].includes(name ?? "")
    );
  if (
    !["keys", "secrets"].includes(kind ?? "") ||
    !namePattern.test(name ?? "")
  )
    return false;
  if (path.length === 2)
    return ["GET", "DELETE", ...(kind === "secrets" ? ["PUT"] : [])].includes(
      method,
    );
  if (path.length === 3) {
    if (version === "create") return kind === "keys" && method === "POST";
    if (version === "versions") return method === "GET";
    return (
      versionPattern.test(version ?? "") && ["GET", "PATCH"].includes(method)
    );
  }
  return (
    path.length === 4 &&
    kind === "keys" &&
    versionPattern.test(version ?? "") &&
    ["encrypt", "decrypt"].includes(action ?? "") &&
    method === "POST"
  );
}
async function boundedText(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("Size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function forwardVault(
  request: Request,
  path: string[],
  options: ProxyOptions,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    (request.headers.get("host") && request.headers.get("host") !== url.host)
  )
    return failure(403, "Forbidden");
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== url.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return failure(403, "Forbidden");
  if (!options.userId) return failure(401, "SignInRequired");
  // Clerk owns Authorization on incoming requests; vault tokens use a distinct header.
  const vaultToken = request.headers.get("x-vault-token") ?? "";
  const authorization = `Bearer ${vaultToken}`;
  if (!/^Bearer [\x21-\x7e]{32,4096}$/.test(authorization))
    return failure(401, "VaultTokenRequired");
  const catalogToken = request.headers.get("x-vault-catalog-token");
  const isApplicationLink =
    request.method === "PUT" &&
    [4, 6].includes(path.length) &&
    path[0] === "local" &&
    path[1] === "applications" &&
    path[3] === "resources";
  if (
    catalogToken !== null &&
    (!isApplicationLink || !/^[\x21-\x7e]{32,4096}$/.test(catalogToken))
  )
    return failure(400, "BadParameter");
  const tenantTokens = request.headers.get("x-vault-tenant-tokens");
  if (tenantTokens !== null) {
    if (
      !(
        (request.method === "PUT" &&
          path.join("/") === "local/runtime-configuration") ||
        (request.method === "POST" &&
          path.join("/") === "local/runtime-configuration/import") ||
        (path[0] === "local" &&
          path[1] === "runtime-access-control" &&
          supportedRoute(request.method, path))
      ) ||
      new TextEncoder().encode(tenantTokens).length > 12 * 1024
    )
      return failure(400, "BadParameter");
    try {
      const map: unknown = JSON.parse(tenantTokens);
      if (
        !map ||
        typeof map !== "object" ||
        Array.isArray(map) ||
        Object.entries(map).some(
          ([tenant, token]) =>
            !scopePattern.test(tenant) ||
            tenant === "_shared" ||
            typeof token !== "string" ||
            !/^[\x21-\x7e]{32,4096}$/.test(token),
        )
      )
        return failure(400, "BadParameter");
    } catch {
      return failure(400, "BadParameter");
    }
  }
  const environment = request.headers.get("x-vault-environment") ?? "";
  const tenant = request.headers.get("x-vault-tenant") ?? "";
  if (
    !scopePattern.test(environment) ||
    !scopePattern.test(tenant) ||
    !supportedRoute(request.method, path)
  )
    return failure(400, "BadParameter");
  const isInventory =
    request.method === "GET" &&
    ((path.length === 1 && ["keys", "secrets"].includes(path[0]!)) ||
      path.join("/") === "local/inventory");
  let query = new URLSearchParams();
  try {
    if (url.search && !isInventory) return failure(400, "BadParameter");
    const fields: Record<string, string> = Object.create(null);
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(fields, key)) return failure(400, "BadParameter");
      fields[key] = value;
    }
    if (isInventory) query = inventoryQuery(fields, path[0] === "local");
  } catch {
    return failure(400, "BadParameter");
  }
  let upstream: URL;
  try {
    upstream = new URL(options.upstream);
    if (
      upstream.protocol !== "http:" ||
      upstream.hostname !== "127.0.0.1" ||
      upstream.pathname !== "/" ||
      upstream.username ||
      upstream.password ||
      upstream.search ||
      upstream.hash
    )
      throw Error();
  } catch {
    return failure(503, "VaultNotConfigured");
  }
  let body: string | undefined;
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    (request.method !== "DELETE" ||
      (path[0] === "local" && path[1] === "applications"))
  ) {
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      return failure(415, "JsonRequired");
    try {
      body = await boundedText(request.body, MAX_REQUEST);
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return failure(400, "BadParameter");
    } catch (error) {
      return failure(error instanceof RangeError ? 413 : 400, "BadParameter");
    }
  }
  const target = new URL(
    "/" + path.map(encodeURIComponent).join("/"),
    upstream,
  );
  target.search = query.toString();
  if (path[0] !== "local") target.searchParams.set("api-version", "2025-07-01");
  try {
    const response = await (options.fetch ?? fetch)(target, {
      method: request.method,
      headers: {
        authorization,
        ...(tenantTokens === null
          ? {}
          : { "x-vault-tenant-tokens": tenantTokens }),
        ...(catalogToken === null
          ? {}
          : { "x-vault-catalog-token": catalogToken }),
        "x-vault-environment": environment,
        "x-vault-tenant": tenant,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) {
      let inventoryCode: string | undefined;
      if (isInventory && [400, 409].includes(response.status)) {
        try {
          const payload = JSON.parse(await boundedText(response.body, 4096));
          if (
            response.status === 400 &&
            payload?.error?.code === "InvalidContinuationToken"
          )
            inventoryCode = "InvalidContinuationToken";
          if (
            response.status === 409 &&
            payload?.error?.code === "PaginationInvalidated"
          )
            inventoryCode = "PaginationInvalidated";
        } catch {
          /* Never reflect arbitrary upstream messages. */
        }
      } else await response.body?.cancel();
      const codes: Record<number, string> = {
        400: "BadParameter",
        401: "Unauthorized",
        403: "Forbidden",
        404: "NotFound",
        409: "RevisionConflict",
        413: "PayloadTooLarge",
        429: "TooManyRequests",
        503: "VaultUnavailable",
      };
      return failure(
        response.status >= 400 && response.status <= 599
          ? response.status
          : 502,
        inventoryCode ?? codes[response.status] ?? "VaultOperationFailed",
      );
    }
    const value: unknown = JSON.parse(
      await boundedText(response.body, MAX_RESPONSE),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      return failure(502, "InvalidVaultResponse");
    return Response.json(value, { headers: safeHeaders });
  } catch (error) {
    return failure(
      error instanceof DOMException && error.name === "TimeoutError"
        ? 504
        : 502,
      "VaultUnavailable",
    );
  }
}
