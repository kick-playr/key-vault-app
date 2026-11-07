import { auth } from "@clerk/nextjs/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const session = await auth();
    if (!session.userId)
      return Response.json(
        { error: { code: "Unauthorized" } },
        { status: 401, headers },
      );
    const token = await session.getToken();
    const provisioning = process.env.VAULT_PROVISIONING_GRANT;
    if (!token || !provisioning)
      return Response.json(
        { error: { code: "AdministrationUnavailable" } },
        { status: 503, headers },
      );
    if (
      !["GET", "HEAD"].includes(request.method) &&
      request.headers.get("origin") !== new URL(request.url).origin
    )
      return Response.json(
        { error: { code: "Forbidden" } },
        { status: 403, headers },
      );
    const { path } = await context.params;
    if (
      !path.length ||
      path.some(
        (part) =>
          !part ||
          part.includes("/") ||
          part === "." ||
          part === ".." ||
          part.length > 512,
      )
    )
      throw Error();
    const allowed =
      /^(catalog|access|resources(?:\/[A-Za-z0-9-]+(?:\/reveal\/[A-Za-z0-9-]+|\/versions|\/rotations|\/enabled)?)?|applications(?:\/[a-z0-9-]+(?:\/grants)?)?|grants\/[A-Za-z0-9-]+(?:\/rotate)?|assignments\/[a-z0-9-]+|enrollments\/[a-z0-9-]+|links\/[a-z0-9-]+|consent|schemas(?:\/[^/]+)?|rotations\/[A-Za-z0-9-]+\/activate|instances\/[A-Za-z0-9-]+\/retire)$/;
    if (!allowed.test(path.join("/")))
      return Response.json(
        { error: { code: "NotFound" } },
        { status: 404, headers },
      );
    const origin = new URL(
      process.env.VAULT_API_ORIGIN ??
        process.env.VAULT_URL ??
        "http://127.0.0.1:4000",
    );
    if (
      origin.username ||
      origin.password ||
      (!["https:"].includes(origin.protocol) &&
        !(
          origin.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(origin.hostname)
        ))
    )
      throw Error();
    const url = new URL(
        "/v2/admin/" + path.map(encodeURIComponent).join("/"),
        origin,
      ),
      query = new URL(request.url).searchParams;
    for (const name of [
      "environment",
      "ownerType",
      "ownerId",
      "limit",
      "after",
    ])
      if (query.has(name)) url.searchParams.set(name, query.get(name)!);
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.text();
    if (body && Buffer.byteLength(body) > 128 * 1024)
      return Response.json(
        { error: { code: "TooLarge" } },
        { status: 413, headers },
      );
    const response = await fetch(url, {
      method: request.method,
      headers: {
        authorization: "Bearer " + token,
        "x-vault-provisioning": "Bearer " + provisioning,
        "content-type": "application/json",
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok)
      return Response.json(
        {
          error: {
            code:
              response.status === 403
                ? "ApprovalOrPermissionRequired"
                : "VaultUnavailable",
          },
        },
        {
          status: [400, 401, 403, 404, 409, 413].includes(response.status)
            ? response.status
            : 503,
          headers,
        },
      );
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Error();
    return new Response(text, {
      status: response.status,
      headers: {
        ...headers,
        "content-type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return Response.json(
      { error: { code: "VaultUnavailable" } },
      { status: 503, headers },
    );
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
