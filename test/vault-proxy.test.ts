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
test("accepts the localhost UI origin while keeping the vault upstream on numeric loopback", async () => {
  const req = new Request("http://localhost:4001/api/vault/keys/demo", {
    headers: {
      "x-vault-token": token,
      "x-vault-environment": "dev",
      "x-vault-tenant": "club-a",
      origin: "http://localhost:4001",
      host: "localhost:4001",
    },
  });
  const result = await forwardVault(req, ["keys", "demo"], {
    ...options,
    fetch: async (url) => {
      assert.equal(new URL(String(url)).hostname, "127.0.0.1");
      return Response.json({ key: { kid: "fixture" } });
    },
  });
  assert.equal(result.status, 200);
});
test("connection validation forwards the complete suffixed token and propagates rejection", async () => {
  const invalid = token + "asdfasdfasfs";
  const response = await forwardVault(
    new Request("http://localhost:4001/api/vault/local/session", {
      headers: {
        "x-vault-token": invalid,
        "x-vault-environment": "dev",
        "x-vault-tenant": "club-a",
      },
    }),
    ["local", "session"],
    {
      ...options,
      fetch: async (url, init) => {
        assert.equal(String(url), "http://127.0.0.1:4000/local/session");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${invalid}`,
        );
        return Response.json(
          { error: { code: "Unauthorized", message: invalid } },
          { status: 401 },
        );
      },
    },
  );
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes(invalid));
});

test("runtime configuration routes bound tenant token map and never forward it elsewhere", async () => {
  const map = JSON.stringify({ "club-a": token });
  let forwarded: Headers | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    forwarded = new Headers(init?.headers);
    return Response.json({ revision: 1, configuration: {} });
  };
  const response = await forwardVault(
    request("PUT", "{}", { "x-vault-tenant-tokens": map }),
    ["local", "runtime-configuration"],
    { ...options, fetch: fetcher },
  );
  assert.equal(response.status, 200);
  assert.equal(forwarded?.get("x-vault-tenant-tokens"), map);
  for (const value of [
    map,
    "x".repeat(12289),
    JSON.stringify({ "../bad": token }),
    JSON.stringify({ "club-a": "short" }),
  ]) {
    assert.equal(
      (
        await forwardVault(
          request("PUT", "{}", { "x-vault-tenant-tokens": value }),
          ["secrets", "demo"],
          options,
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await forwardVault(
        request("PUT", "{}", { "x-vault-tenant-tokens": "x".repeat(12289) }),
        ["local", "runtime-configuration"],
        options,
      )
    ).status,
    400,
  );
});

test("runtime access administration admits only explicit app tenant GET/PUT with bounded grants", async () => {
  const map = JSON.stringify({ "club-a": token });
  for (const method of ["GET", "PUT"]) {
    const response = await forwardVault(
      request(
        method,
        method === "PUT" ? JSON.stringify({ allow: true }) : undefined,
        { "x-vault-tenant-tokens": map },
      ),
      ["local", "runtime-access-control", "club-api", "tenants", "club-a"],
      {
        ...options,
        fetch: async (_input, init) => {
          assert.equal(
            new Headers(init?.headers).get("x-vault-tenant-tokens"),
            map,
          );
          return Response.json({
            application: "club-api",
            tenant: "club-a",
            identityConfigured: true,
            authorized: false,
          });
        },
      },
    );
    assert.equal(response.status, 200);
  }
  for (const path of [
    ["local", "runtime-access-control"],
    ["local", "runtime-access-control", "club-api", "tenants"],
    ["local", "runtime-access-control", "club-api", "tenants", "_shared"],
    ["local", "runtime-access-control", "club-api", "tenants", "../bad"],
  ])
    assert.equal((await forwardVault(request(), path, options)).status, 400);
});

test("import preview may forward bounded tenant proofs only on its exact configuration route", async () => {
  const map = JSON.stringify({ "club-a": token });
  const response = await forwardVault(
    request("POST", "{}", { "x-vault-tenant-tokens": map }),
    ["local", "runtime-configuration", "import"],
    {
      ...options,
      fetch: async (_input, init) => {
        assert.equal(
          new Headers(init?.headers).get("x-vault-tenant-tokens"),
          map,
        );
        return Response.json({ configuration: {} });
      },
    },
  );
  assert.equal(response.status, 200);
});
