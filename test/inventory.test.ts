import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryQuery,
  continuationPath,
  parseInventory,
} from "../src/lib/inventory";
import { forwardVault } from "../src/lib/vault-proxy";
const scope = { environment: "dev", tenant: "club-a" };
test("inventory query accepts the implemented filters and preserves an empty exact tag value", () => {
  assert.equal(
    inventoryQuery(
      {
        kind: "secret",
        name: "demo",
        namePrefix: "db-",
        purpose: "database",
        enabled: "false",
        expiresBefore: "2",
        tagName: "owner",
        tagValue: "",
        maxresults: "5",
      },
      true,
    ).toString(),
    "kind=secret&name=demo&namePrefix=db-&purpose=database&enabled=false&expiresBefore=2&tagName=owner&tagValue=&maxresults=5",
  );
  for (const fields of [
    { maxresults: "26" },
    { tagName: "owner" },
    { enabled: "yes" },
    { namePrefix: "../" },
    { expiresBefore: "-1" },
    { kind: "all" },
    { unknown: "bad" },
  ] as Record<string, string>[])
    assert.throws(() => inventoryQuery(fields, true));
  assert.throws(() => inventoryQuery({ purpose: "data" }, false));
});
test("pagination stays bound to loopback, endpoint and namespace without following remote links", () => {
  assert.equal(
    continuationPath(
      "http://127.0.0.1:4000/namespaces/dev/club-a/keys?api-version=2025-07-01&maxresults=1&$skiptoken=abc.def",
      "keys",
      scope,
    ),
    "keys?maxresults=1&%24skiptoken=abc.def",
  );
  for (const link of [
    "https://evil.example/namespaces/dev/club-a/keys?$skiptoken=abc.def",
    "http://127.0.0.1:4000/namespaces/dev/club-b/keys?$skiptoken=abc.def",
    "http://127.0.0.1:4000/namespaces/dev/club-a/secrets?$skiptoken=abc.def",
    "http://127.0.0.1:4000/namespaces/dev/club-a/keys?token=secret",
    "$skiptoken=abc.def",
  ])
    assert.throws(() => continuationPath(link, "keys", scope));
});
test("parses metadata into explicit rows and rejects missing/foreign resource ids", () => {
  assert.deepEqual(
    parseInventory(
      {
        value: [
          {
            kid: "http://127.0.0.1:4000/namespaces/dev/club-a/keys/demo",
            attributes: { enabled: false, exp: 1 },
            tags: { purpose: "database" },
          },
        ],
      },
      "keys",
      scope,
    ),
    {
      rows: [
        {
          kind: "key",
          name: "demo",
          version: "",
          enabled: false,
          expires: 1,
          purpose: "database",
          tags: { purpose: "database" },
        },
      ],
      nextLink: undefined,
    },
  );
  const local = {
    name: "demo",
    kind: "secret",
    id: "http://127.0.0.1:4000/namespaces/dev/club-a/secrets/demo",
    version: "v1",
    versionId: "http://127.0.0.1:4000/namespaces/dev/club-a/secrets/demo/v1",
    attributes: { enabled: true },
    value: "must-not-render",
  };
  const parsed = parseInventory({ value: [local] }, "local/inventory", scope);
  assert.equal(parsed.rows[0]!.version, "v1");
  assert.equal(JSON.stringify(parsed).includes("must-not-render"), false);
  assert.throws(() =>
    parseInventory(
      { value: [{ ...local, id: local.id.replace("club-a", "club-b") }] },
      "local/inventory",
      scope,
    ),
  );
});
test("forwards only supported inventory query parameters and keeps local search unversioned", async () => {
  for (const endpoint of ["keys", "secrets", "local/inventory"]) {
    const query = endpoint.startsWith("local")
      ? "kind=secret&namePrefix=db-&tagName=owner&tagValue=&maxresults=1&%24skiptoken=abc.def"
      : "maxresults=1&%24skiptoken=abc.def";
    let target = "";
    const response = await forwardVault(
      new Request(`http://127.0.0.1:3003/api/vault/${endpoint}?${query}`, {
        headers: {
          "x-vault-token": "fixture-only-list-token-00000000000000",
          "x-vault-environment": "dev",
          "x-vault-tenant": "club-a",
        },
      }),
      endpoint.split("/"),
      {
        userId: "user_fixture",
        upstream: "http://127.0.0.1:4000",
        fetch: async (url) => {
          target = String(url);
          return Response.json({ value: [] });
        },
      },
    );
    assert.equal(response.status, 200);
    const url = new URL(target);
    assert.equal(url.searchParams.get("$skiptoken"), "abc.def");
    assert.equal(
      url.searchParams.get("api-version"),
      endpoint.startsWith("local") ? null : "2025-07-01",
    );
  }
  for (const suffix of [
    "?purpose=data",
    "?maxresults=1&maxresults=2",
    "?token=secret",
    "?__proto__=bad",
    "?maxresults=26",
  ]) {
    const response = await forwardVault(
      new Request("http://127.0.0.1:3003/api/vault/keys" + suffix, {
        headers: {
          "x-vault-token": "fixture-only-list-token-00000000000000",
          "x-vault-environment": "dev",
          "x-vault-tenant": "club-a",
        },
      }),
      ["keys"],
      {
        userId: "user_fixture",
        upstream: "http://127.0.0.1:4000",
        fetch: async () => {
          throw Error("must not forward");
        },
      },
    );
    assert.equal(response.status, 400);
  }
});
test("preserves only safe inventory error codes for restart guidance", async () => {
  for (const [status, code] of [
    [409, "PaginationInvalidated"],
    [400, "InvalidContinuationToken"],
  ] as const) {
    const response = await forwardVault(
      new Request("http://127.0.0.1:3003/api/vault/keys", {
        headers: {
          "x-vault-token": "fixture-only-list-token-00000000000000",
          "x-vault-environment": "dev",
          "x-vault-tenant": "club-a",
        },
      }),
      ["keys"],
      {
        userId: "user_fixture",
        upstream: "http://127.0.0.1:4000",
        fetch: async () =>
          Response.json(
            { error: { code, message: "sensitive-upstream-text" } },
            { status },
          ),
      },
    );
    assert.deepEqual(await response.json(), { error: { code, message: code } });
  }
});
test("allows bounded literal name-or-purpose search only on local inventory", () => {
  assert.equal(
    inventoryQuery({ search: "Data Base.*" }, true).get("search"),
    "Data Base.*",
  );
  for (const search of ["x".repeat(513), "bad\nsearch"])
    assert.throws(() => inventoryQuery({ search }, true));
  assert.throws(() => inventoryQuery({ search: "database" }, false));
});
test("forwards name-or-purpose search through the existing scoped proxy", async () => {
  let observed = "";
  const response = await forwardVault(
    new Request(
      "http://127.0.0.1:4001/api/vault/local/inventory?kind=secret&search=Data+Base",
      {
        headers: {
          "x-vault-token": "fixture-token-123456789012345678901234",
          "x-vault-environment": "dev",
          "x-vault-tenant": "club-a",
        },
      },
    ),
    ["local", "inventory"],
    {
      userId: "fixture",
      upstream: "http://127.0.0.1:4000",
      fetch: async (url) => {
        observed = String(url);
        return Response.json({ value: [] });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(new URL(observed).searchParams.get("search"), "Data Base");
});
test("parses optional version counts without inventing missing counts", () => {
  const row = {
    kind: "secret",
    name: "demo",
    id: "http://127.0.0.1:4000/namespaces/dev/club-a/secrets/demo",
    version: "v1",
    versionId: "http://127.0.0.1:4000/namespaces/dev/club-a/secrets/demo/v1",
    attributes: { enabled: true },
  };
  assert.equal(
    parseInventory(
      { value: [{ ...row, versionCount: 3 }] },
      "local/inventory",
      scope,
    ).rows[0]?.versionCount,
    3,
  );
  assert.equal(
    parseInventory({ value: [row] }, "local/inventory", scope).rows[0]
      ?.versionCount,
    undefined,
  );
  assert.throws(() =>
    parseInventory(
      { value: [{ ...row, versionCount: 0 }] },
      "local/inventory",
      scope,
    ),
  );
});
