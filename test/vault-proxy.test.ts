import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardVault } from "../src/lib/vault-proxy";
const token = "fixture-token-for-local-tests-only-12345";
function request(
  method = "GET",
  body?: string,
  headers: Record<string, string> = {},
) {
  return new Request("http://127.0.0.1:3003/api/vault/keys/demo", {
    method,
    headers: {
      "x-vault-token": token,
      "x-vault-environment": "dev",
      "x-vault-tenant": "club-a",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body,
  });
}
const neverFetch: typeof fetch = async () => {
  throw new Error("unexpected network request");
};
const options = {
  userId: "user_fixture",
  upstream: "http://127.0.0.1:4000",
  fetch: neverFetch,
};
test("requires Clerk session and scoped vault credentials before forwarding", async () => {
  assert.equal(
    (
      await forwardVault(request(), ["keys", "demo"], {
        ...options,
        userId: null,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await forwardVault(
        request("GET", undefined, { "x-vault-token": "" }),
        ["keys", "demo"],
        options,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await forwardVault(
        request("GET", undefined, { "x-vault-tenant": "../club-b" }),
        ["keys", "demo"],
        options,
      )
    ).status,
    400,
  );
});
test("rejects cross-origin, non-loopback and disallowed destinations/routes", async () => {
  for (const origin of [
    "https://evil.example",
    "null",
    "http://127.0.0.1:4000",
  ])
    assert.equal(
      (
        await forwardVault(
          request("GET", undefined, { origin }),
          ["keys", "demo"],
          options,
        )
      ).status,
      403,
    );
  assert.equal(
    (
      await forwardVault(
        request("GET", undefined, { "sec-fetch-site": "cross-site" }),
        ["keys", "demo"],
        options,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await forwardVault(
        new Request("http://evil.example/api/vault/keys/demo"),
        ["keys", "demo"],
        options,
      )
    ).status,
    403,
  );
  for (const path of [
    ["keys", ".."],
    ["keys", "%2f"],
    ["certificates"],
    ["local", "grants"],
    ["keys", "demo", "version", "sign"],
  ])
    assert.equal((await forwardVault(request(), path, options)).status, 400);
  assert.equal(
    (
      await forwardVault(request(), ["keys", "demo"], {
        ...options,
        upstream: "https://evil.example",
      })
    ).status,
    503,
  );
});
test("forwards exact scope and API version to fixed upstream without cookies or origin", async () => {
  const result = await forwardVault(
    request("GET", undefined, {
      cookie: "secret-cookie",
      origin: "http://127.0.0.1:3003",
    }),
    ["keys", "demo", "abc123"],
    {
      ...options,
      fetch: async (url, init) => {
        assert.equal(
          String(url),
          "http://127.0.0.1:4000/keys/demo/abc123?api-version=2025-07-01",
        );
        const h = new Headers(init?.headers);
        assert.equal(h.get("authorization"), `Bearer ${token}`);
        assert.equal(h.get("x-vault-tenant"), "club-a");
        assert.equal(h.get("x-vault-environment"), "dev");
        assert.equal(h.get("cookie"), null);
        assert.equal(h.get("origin"), null);
        assert.equal(init?.redirect, "error");
        assert.equal(init?.cache, "no-store");
        return Response.json({
          key: { kid: "fixture", kty: "RSA", n: "public", e: "AQAB" },
        });
      },
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), {
    key: { kid: "fixture", kty: "RSA", n: "public", e: "AQAB" },
  });
});
test("bounds and validates JSON bodies before sending to the vault", async () => {
  for (const body of [
    "{",
    "[]",
    "null",
    '"secret"',
    JSON.stringify({ value: "x".repeat(131072) }),
  ])
    assert.equal(
      (await forwardVault(request("PUT", body), ["secrets", "demo"], options))
        .status,
      body.length > 131072 ? 413 : 400,
    );
  assert.equal(
    (
      await forwardVault(
        request("PUT", "{}", { "content-type": "text/plain" }),
        ["secrets", "demo"],
        options,
      )
    ).status,
    415,
  );
});
test("local reconciliation omits API version and preserves request body", async () => {
  const body = JSON.stringify({
    revision: 1,
    manifest: { schemaVersion: 1, entries: [] },
  });
  const result = await forwardVault(
    request("POST", body),
    ["local", "reconcile"],
    {
      ...options,
      fetch: async (url, init) => {
        assert.equal(String(url), "http://127.0.0.1:4000/local/reconcile");
        assert.equal(init?.body, body);
        return Response.json({ revision: 1, mappings: {} });
      },
    },
  );
  assert.equal(result.status, 200);
});
test("sanitizes upstream failures and malformed responses without echoing secrets", async () => {
  for (const response of [
    new Response("secret", { status: 500 }),
    Response.json(
      { error: { code: "Forbidden", message: token } },
      { status: 403 },
    ),
    new Response("<html>secret</html>"),
  ]) {
    const result = await forwardVault(request(), ["keys", "demo"], {
      ...options,
      fetch: async () => response,
    });
    assert.ok(result.status >= 400);
    assert.ok(!(await result.text()).includes(token));
  }
  const down = await forwardVault(request(), ["keys", "demo"], {
    ...options,
    fetch: async () => {
      throw Error(token);
    },
  });
  assert.equal(down.status, 502);
  assert.ok(!(await down.text()).includes(token));
});
