import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { forwardVault } from "../src/lib/vault-proxy";
import { buildOperation, type Fields } from "../src/lib/operations";
// Isolated HTTP fixture: validates real wire shape, permissions and namespace headers.
// This is not a live Azure or MongoDB conformance test.
test("secret lifecycle crosses the real HTTP forwarder with isolation and permission denials", async () => {
  const token = "fixture-full-access-token-000000000000";
  const readToken = "fixture-read-only-token-00000000000000";
  const namespaces = new Map<
    string,
    { version: string; value: string; enabled: boolean }[]
  >();
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    const scope = String(req.headers["x-vault-tenant"]);
    const auth = req.headers.authorization;
    if (![token, readToken].some((t) => auth === `Bearer ${t}`))
      return send(401, { error: { code: "Unauthorized" } });
    if (scope !== "club-a" || req.headers["x-vault-environment"] !== "dev")
      return send(403, { error: { code: "Forbidden" } });
    if (auth === `Bearer ${readToken}` && req.method !== "GET")
      return send(403, { error: { code: "Forbidden" } });
    const url = new URL(req.url!, "http://127.0.0.1");
    assert.equal(url.searchParams.get("api-version"), "2025-07-01");
    const [, kind, name, version] = url.pathname.split("/");
    assert.equal(kind, "secrets");
    assert.equal(name, "demo");
    const key = `${scope}/${name}`;
    const versions = namespaces.get(key) ?? [];
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    if (req.method === "PUT") {
      const item = {
        version: `v${versions.length + 1}`,
        value: body.value,
        enabled: true,
      };
      versions.push(item);
      namespaces.set(key, versions);
      return send(200, {
        id: `http://127.0.0.1/namespaces/dev/${scope}/secrets/demo/${item.version}`,
        value: item.value,
        attributes: { enabled: true },
      });
    }
    if (!versions.length)
      return send(404, { error: { code: "SecretNotFound" } });
    if (req.method === "DELETE") {
      namespaces.delete(key);
      return send(200, { id: "deleted", attributes: { enabled: true } });
    }
    if (version === "versions")
      return send(200, {
        value: versions.map((v) => ({
          id: `http://127.0.0.1/namespaces/dev/${scope}/secrets/demo/${v.version}`,
          attributes: { enabled: v.enabled },
        })),
      });
    const item = version
      ? versions.find((v) => v.version === version)
      : versions.at(-1);
    if (!item) return send(404, { error: { code: "SecretNotFound" } });
    if (req.method === "PATCH") {
      item.enabled = body.attributes.enabled;
      return send(200, {
        id: item.version,
        attributes: { enabled: item.enabled },
      });
    }
    if (!item.enabled) return send(403, { error: { code: "Forbidden" } });
    return send(200, {
      id: item.version,
      value: item.value,
      attributes: { enabled: item.enabled },
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const upstream = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function run(
    id: string,
    fields: Fields = {},
    tenant = "club-a",
    credential = token,
  ) {
    const op = buildOperation(id, { name: "demo", ...fields });
    return forwardVault(
      new Request("http://127.0.0.1:3003/api/vault/" + op.path, {
        method: op.method,
        headers: {
          "x-vault-token": credential,
          "x-vault-environment": "dev",
          "x-vault-tenant": tenant,
          ...(op.body ? { "content-type": "application/json" } : {}),
        },
        body: op.body ? JSON.stringify(op.body) : undefined,
      }),
      op.path.split("/"),
      { userId: "user_fixture", upstream },
    );
  }
  try {
    assert.equal((await run("secret-read")).status, 404);
    assert.equal((await run("secret-set", { value: "first" })).status, 200);
    assert.equal((await run("secret-set", { value: "second" })).status, 200);
    assert.equal((await (await run("secret-read")).json()).value, "second");
    assert.equal(
      (await (await run("secret-read", { exactVersion: "v1" })).json()).value,
      "first",
    );
    const versions = await (await run("secret-versions")).json();
    assert.equal(versions.value.length, 2);
    assert.equal("value" in versions.value[0], false);
    assert.equal((await run("secret-read", {}, "club-b")).status, 403);
    assert.equal(
      (await run("secret-set", { value: "denied" }, "club-a", readToken))
        .status,
      403,
    );
    const patch = await run("secret-update", {
      version: "v1",
      enabled: "false",
    });
    assert.equal(patch.status, 200);
    assert.equal("value" in (await patch.json()), false);
    assert.equal(
      (await run("secret-read", { exactVersion: "v1" })).status,
      403,
    );
    assert.equal(
      (await run("secret-delete", { confirmation: "demo" })).status,
      200,
    );
    assert.equal((await run("secret-read")).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
