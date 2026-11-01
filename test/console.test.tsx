import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:3003",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  FormData: dom.window.FormData,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { render, screen, fireEvent, waitFor, cleanup, act } =
  await import("@testing-library/react");
const { VaultConsole } = await import("../src/components/vault-console");
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
});
function connect() {
  fireEvent.change(screen.getByLabelText("Environment"), {
    target: { value: "dev" },
  });
  fireEvent.change(screen.getByLabelText("Tenant / namespace"), {
    target: { value: "club-a" },
  });
  fireEvent.change(screen.getByLabelText("Vault bearer token"), {
    target: { value: "fixture-token-for-local-tests-only-12345" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect to namespace" }));
}
test("opens a secret through scoped request and keeps its result masked until explicit reveal", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/vault/secrets/demo");
    const h = new Headers(init?.headers);
    assert.equal(h.get("authorization"), null);
    assert.equal(
      h.get("x-vault-token"),
      "fixture-token-for-local-tests-only-12345",
    );
    assert.equal(h.get("x-vault-tenant"), "club-a");
    assert.equal(h.get("x-vault-environment"), "dev");
    return Response.json({
      id: "http://127.0.0.1:4000/namespaces/dev/club-a/secrets/demo/v1",
      value: "fixture-secret-value",
      attributes: { enabled: true },
    });
  };
  render(<VaultConsole />);
  connect();
  fireEvent.click(screen.getByRole("button", { name: "Secrets" }));
  fireEvent.change(screen.getByLabelText("Resource name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run Open secret" }));
  await screen.findByText("Operation completed.");
  assert.equal(screen.queryByText(/fixture-secret-value/), null);
  fireEvent.click(screen.getByRole("button", { name: "Reveal result" }));
  assert.ok(screen.getByText(/fixture-secret-value/));
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  assert.equal(screen.queryByText(/fixture-secret-value/), null);
  assert.equal(
    (screen.getByLabelText("Vault bearer token") as HTMLInputElement).value,
    "",
  );
});
test("destructive actions need the name confirmation before any network request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({});
  };
  render(<VaultConsole />);
  connect();
  fireEvent.change(screen.getByLabelText("Operation"), {
    target: { value: "key-delete" },
  });
  fireEvent.change(screen.getByLabelText("Resource name"), {
    target: { value: "demo" },
  });
  assert.ok(screen.getByText(/Permanently delete ALL versions/));
  fireEvent.click(screen.getByRole("button", { name: "Run Delete key" }));
  assert.equal(calls, 0);
  fireEvent.change(screen.getByLabelText("Type resource name to confirm"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run Delete key" }));
  await screen.findByText("Operation completed.");
  assert.equal(calls, 1);
});
test("discards an in-flight response after disconnect and never restores another namespace data", async () => {
  let resolve!: (r: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((r) => {
      resolve = r;
    });
  render(<VaultConsole />);
  connect();
  fireEvent.change(screen.getByLabelText("Resource name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run Open key" }));
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await act(async () =>
    resolve(Response.json({ value: "stale-sensitive-value" })),
  );
  assert.equal(screen.queryByText("Operation completed."), null);
  assert.equal(screen.queryByRole("button", { name: "Reveal result" }), null);
});
test("permission errors are announced without exposing upstream response text", async () => {
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: "Forbidden", message: "sensitive-upstream-error" } },
      { status: 403 },
    );
  render(<VaultConsole />);
  connect();
  fireEvent.change(screen.getByLabelText("Resource name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run Open key" }));
  await waitFor(() =>
    assert.match(screen.getByRole("alert").textContent ?? "", /permission/i),
  );
  assert.equal(screen.queryByText(/sensitive-upstream-error/), null);
});
test("failed reconciliation preserves editable manifest and supports exact-payload retry including masked secrets", async () => {
  const payloads: string[] = [];
  globalThis.fetch = async (_url, init) => {
    payloads.push(String(init?.body));
    return payloads.length === 1
      ? Response.json({ error: { code: "VaultUnavailable" } }, { status: 504 })
      : Response.json({ revision: 4, mappings: {} });
  };
  render(<VaultConsole />);
  connect();
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  const manifest =
    '{"schemaVersion":1,"entries":[{"purpose":"database","kind":"secret","scope":"tenant","envName":"APP_DATABASE_URL"}]}';
  fireEvent.change(screen.getByLabelText("Manifest (JSON)"), {
    target: { value: manifest },
  });
  fireEvent.change(screen.getByLabelText("Configuration revision"), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByLabelText("Supplied secrets (JSON object)"), {
    target: { value: '{"database":"fixture-secret"}' },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Run Reconcile manifest" }),
  );
  await screen.findByRole("alert");
  assert.equal(
    (screen.getByLabelText("Manifest (JSON)") as HTMLTextAreaElement).value,
    manifest,
  );
  assert.equal(
    (screen.getByLabelText("Configuration revision") as HTMLInputElement).value,
    "4",
  );
  assert.equal(
    (
      screen.getByLabelText(
        "Supplied secrets (JSON object)",
      ) as HTMLInputElement
    ).value,
    "",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry identical reconciliation" }),
  );
  await screen.findByText("Operation completed.");
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1], payloads[0]);
});
test("version selection fills the exact version without revealing the raw response", async () => {
  globalThis.fetch = async () =>
    Response.json({
      value: [
        {
          id: "http://127.0.0.1:4000/namespaces/dev/club-a/secrets/demo/v1",
          attributes: { enabled: true },
        },
      ],
    });
  render(<VaultConsole />);
  connect();
  fireEvent.click(screen.getByRole("button", { name: "Secrets" }));
  fireEvent.change(screen.getByLabelText("Operation"), {
    target: { value: "secret-versions" },
  });
  fireEvent.change(screen.getByLabelText("Resource name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run Versions" }));
  await screen.findByText("Operation completed.");
  fireEvent.click(screen.getByRole("button", { name: "Open version" }));
  assert.equal(
    (screen.getByLabelText("Version (optional)") as HTMLInputElement).value,
    "v1",
  );
  assert.equal(
    (screen.getByLabelText("Resource name") as HTMLInputElement).value,
    "demo",
  );
});
