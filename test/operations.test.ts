import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOperation, operations } from "../src/lib/operations";
const base = { name: "demo", version: "abc123" };
test("covers each supported key and secret route without changing exact versions", () => {
  const cases = [
    ["key-read", "GET", "keys/demo"],
    ["key-versions", "GET", "keys/demo/versions"],
    ["key-create", "POST", "keys/demo/create"],
    ["key-update", "PATCH", "keys/demo/abc123"],
    ["key-delete", "DELETE", "keys/demo"],
    ["encrypt", "POST", "keys/demo/abc123/encrypt"],
    ["decrypt", "POST", "keys/demo/abc123/decrypt"],
    ["secret-read", "GET", "secrets/demo"],
    ["secret-versions", "GET", "secrets/demo/versions"],
    ["secret-set", "PUT", "secrets/demo"],
    ["secret-update", "PATCH", "secrets/demo/abc123"],
    ["secret-delete", "DELETE", "secrets/demo"],
    ["reconcile", "POST", "local/reconcile"],
    ["snapshot", "POST", "local/snapshot"],
  ];
  assert.equal(operations.length, cases.length);
  for (const [id, method, path] of cases) {
    const op = buildOperation(id!, {
      ...base,
      value: "c2VjcmV0",
      confirmation: "demo",
      manifest:
        '{"schemaVersion":1,"entries":[{"purpose":"example","kind":"key"}]}',
      revision: "1",
    });
    assert.equal(op.method, method);
    assert.equal(op.path, path);
  }
  assert.equal(
    buildOperation("key-read", { ...base, exactVersion: "abc123" }).path,
    "keys/demo/abc123",
  );
  assert.equal(
    buildOperation("secret-read", { ...base, exactVersion: "abc123" }).path,
    "secrets/demo/abc123",
  );
});
test("creates RSA keys and metadata patches without leaking secret fields", () => {
  assert.deepEqual(
    buildOperation("key-create", {
      ...base,
      keySize: "3072",
      keyOps: "encrypt,decrypt",
      tags: '{"owner":"test"}',
    }).body,
    {
      kty: "RSA",
      key_size: 3072,
      key_ops: ["encrypt", "decrypt"],
      tags: { owner: "test" },
    },
  );
  assert.deepEqual(
    buildOperation("secret-update", {
      ...base,
      enabled: "false",
      nbf: "0",
      exp: "2000000000",
      contentType: "text/plain",
      value: "must-not-forward",
    }).body,
    {
      attributes: { enabled: false, nbf: 0, exp: 2000000000 },
      contentType: "text/plain",
    },
  );
  assert.deepEqual(buildOperation("secret-set", { ...base, value: "" }).body, {
    value: "",
  });
  assert.deepEqual(
    buildOperation("encrypt", { ...base, value: "aGVsbG8" }).body,
    { alg: "RSA-OAEP-256", value: "aGVsbG8" },
  );
});
test("requires explicit destructive confirmation and validates identifiers and payloads", () => {
  for (const fields of [
    { ...base, confirmation: "" },
    { ...base, confirmation: "other" },
  ])
    assert.throws(() => buildOperation("key-delete", fields));
  for (const fields of [
    { ...base, name: "../demo" },
    { ...base, version: "" },
  ])
    assert.throws(() => buildOperation("key-update", fields));
  for (const fields of [
    { ...base, keySize: "4096" },
    { ...base, tags: "[]" },
    { ...base, exp: "NaN" },
    { ...base, keyOps: "sign" },
  ])
    assert.throws(() => buildOperation("key-create", fields));
  assert.throws(() =>
    buildOperation("encrypt", { ...base, value: "not base64+" }),
  );
  assert.throws(() =>
    buildOperation("reconcile", { manifest: "{}", revision: "0" }),
  );
});
test("reconciliation sends parsed manifest and provided secrets, snapshot excludes revision and secrets", () => {
  const fields = {
    manifest:
      '{"schemaVersion":1,"entries":[{"purpose":"example","kind":"key"}]}',
    revision: "3",
    suppliedSecrets: '{"database":"fixture"}',
  };
  assert.deepEqual(buildOperation("reconcile", fields).body, {
    revision: 3,
    manifest: {
      schemaVersion: 1,
      entries: [{ purpose: "example", kind: "key" }],
    },
    secrets: { database: "fixture" },
  });
  assert.deepEqual(buildOperation("snapshot", fields).body, {
    manifest: {
      schemaVersion: 1,
      entries: [{ purpose: "example", kind: "key" }],
    },
  });
});
test("matches API edge cases for metadata clearing, manifest bounds and canonical crypto inputs", () => {
  assert.deepEqual(
    buildOperation("secret-update", { ...base, clearContentType: "on" }).body,
    { contentType: "" },
  );
  assert.deepEqual(buildOperation("encrypt", { ...base, value: "" }).body, {
    alg: "RSA-OAEP-256",
    value: "",
  });
  assert.throws(() => buildOperation("encrypt", { ...base, value: "AB" }));
  assert.throws(() =>
    buildOperation("key-update", { ...base, nbf: "20", exp: "10" }),
  );
  assert.throws(() =>
    buildOperation("secret-set", {
      ...base,
      value: "fixture",
      contentType: "x".repeat(256),
    }),
  );
  assert.throws(() =>
    buildOperation("snapshot", {
      manifest: '{"schemaVersion":1,"entries":[]}',
    }),
  );
});
