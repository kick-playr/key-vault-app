import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:4001",
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
const { render, screen, fireEvent, cleanup, waitFor, act } = await import(
  "@testing-library/react"
);
const { VaultConsole } = await import("../src/components/vault-console");
const originalFetch = globalThis.fetch;
const id = "http://127.0.0.1:4000/namespaces/development/club-a/secrets/demo/";
const versions = {
  value: [
    { id: id + "v1", attributes: { enabled: true, created: 1, updated: 1 } },
    {
      id: id + "v2",
      attributes: { enabled: false, created: 2, updated: 2 },
      contentType: "text/plain",
    },
  ],
};
let calls: { url: string; method: string; body?: Record<string, unknown> }[] =
  [];
function setup(
  handler?: (url: string, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/local/session"))
      return Response.json({
        authenticated: true,
        environment: "development",
        tenant: "club-a",
      });
    if (handler) {
      const result = await handler(url, init);
      return result;
    }
    return Response.json(url.endsWith("/versions") ? versions : { value: [] });
  };
  render(<VaultConsole />);
}
async function connect() {
  fireEvent.change(screen.getByLabelText("Tenant / namespace"), {
    target: { value: "club-a" },
  });
  fireEvent.change(screen.getByLabelText("Vault bearer token"), {
    target: { value: "fixture-token-for-tests-123456789012345" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect to namespace" }));
  await screen.findByRole("button", { name: "Disconnect" });
}
async function secrets() {
  await connect();
  fireEvent.click(
    screen.getByRole("button", { name: "Secrets (Azure-style)" }),
  );
  await screen.findByRole("button", { name: "Generate/Import" });
}
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  calls = [];
});
test("adds two sections without removing fallback and opens history without reading values", async () => {
  setup();
  await secrets();
  for (const name of [
    "Keys",
    "Secrets",
    "Advanced",
    "Keys (Azure-style)",
    "Secrets (Azure-style)",
  ])
    assert.ok(screen.getByRole("button", { name }));
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await screen.findByText("CURRENT VERSION");
  assert.ok(screen.getByRole("button", { name: "Version v2" }));
  assert.equal(screen.getAllByText("Disabled").length, 2);
  assert.equal(
    calls.some((c) => c.url.endsWith("/secrets/demo")),
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Version v1" }));
  assert.ok(await screen.findByRole("button", { name: "Edit metadata" }));
});
test("creates a secret with masked input, refreshes metadata and discards echoed value", async () => {
  setup(async (url, init) =>
    init?.method === "PUT"
      ? Response.json({
          id: id + "v3",
          value: "echo-sensitive",
          attributes: { enabled: true },
        })
      : Response.json(url.endsWith("/versions") ? versions : { value: [] }),
  );
  await secrets();
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "demo" },
  });
  fireEvent.change(screen.getByLabelText("Secret value"), {
    target: { value: "synthetic-secret" },
  });
  assert.equal(
    screen.getByLabelText("Secret value").getAttribute("type"),
    "password",
  );
  fireEvent.change(screen.getByLabelText("Value format"), {target:{value:"text"}});
  fireEvent.click(screen.getByRole("button", { name: "Create secret" }));
  await screen.findByText(/Saved to vault/);
  assert.deepEqual(calls.find((c) => c.method === "PUT")?.body, {
    value: "synthetic-secret",
    valueFormat: "text",
    attributes: { enabled: true },
  });
  assert.equal(document.body.textContent?.includes("echo-sensitive"), false);
  assert.equal(dom.window.localStorage.length, 0);
});
test("metadata editing uses exact PATCH and no secret read; new value creates a new version", async () => {
  setup(async (url, init) =>
    init?.method === "PATCH"
      ? Response.json({ id: id + "v2", attributes: { enabled: true } })
      : init?.method === "PUT"
        ? Response.json({ id: id + "v3", value: "echo" })
        : Response.json(url.endsWith("/versions") ? versions : { value: [] }),
  );
  await secrets();
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await screen.findByText("CURRENT VERSION");
  fireEvent.click(screen.getByRole("button", { name: "Version v2" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
  await screen.findByRole("button", { name: "Save metadata" });
  assert.equal(screen.queryByLabelText("Secret value"), null);
  fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));
  await screen.findByText(/Saved to vault/);
  assert.ok(
    calls.find((c) => c.method === "PATCH" && c.url.endsWith("/demo/v2")),
  );
  assert.equal(
    calls.some((c) => c.method === "GET" && c.url.endsWith("/secrets/demo/v2")),
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "New version" }));
  fireEvent.change(screen.getByLabelText("Secret value"), {
    target: { value: "new-synthetic" },
  });
  fireEvent.change(screen.getByLabelText("Value format"), {target:{value:"text"}});
  fireEvent.click(screen.getByRole("button", { name: "Create new version" }));
  await screen.findByText(/Saved to vault/);
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
});
test("generates only supported RSA key options", async () => {
  setup(async (url, init) =>
    init?.method === "POST"
      ? Response.json({
          key: { kid: id.replace("/secrets/", "/keys/") + "k1" },
        })
      : Response.json({ value: [] }),
  );
  await connect();
  fireEvent.click(screen.getByRole("button", { name: "Keys (Azure-style)" }));
  fireEvent.click(await screen.findByRole("button", { name: "Generate key" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "demo" },
  });
  fireEvent.change(screen.getByLabelText("RSA key size"), {
    target: { value: "3072" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create key" }));
  await screen.findByText(/Saved to vault/);
  assert.deepEqual(calls.find((c) => c.method === "POST")?.body, {
    kty: "RSA",
    key_size: 3072,
    key_ops: ["encrypt", "decrypt"],
    attributes: { enabled: true },
  });
});
test("dirty forms can stay or discard before switching sections", async () => {
  setup();
  await secrets();
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "unsaved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Keys" }));
  assert.ok(screen.getByRole("button", { name: "Stay" }));
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  assert.equal(
    (screen.getByLabelText("Name") as HTMLInputElement).value,
    "unsaved",
  );
  fireEvent.click(screen.getByRole("button", { name: "Keys" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  assert.ok(await screen.findByLabelText("Resource name"));
});
test("ambiguous write keeps form and never automatically retries", async () => {
  setup(async (url, init) => {
    if (init?.method === "PUT")
      return Response.json(
        { error: { code: "VaultUnavailable" } },
        { status: 504 },
      );
    return Response.json({ value: [] });
  });
  await secrets();
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "demo" },
  });
  fireEvent.change(screen.getByLabelText("Secret value"), {
    target: { value: "test" },
  });
  fireEvent.change(screen.getByLabelText("Value format"), {target:{value:"text"}});
  fireEvent.click(screen.getByRole("button", { name: "Create secret" }));
  await screen.findByText(/outcome is unknown/);
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(
    (screen.getByLabelText("Secret value") as HTMLInputElement).value,
    "test",
  );
});
test("imports a file only on explicit submit and preserves BOM and newlines", async () => {
  setup(async (url, init) =>
    init?.method === "PUT"
      ? Response.json({ id: id + "v3", value: "echo" })
      : Response.json(url.endsWith("/versions") ? versions : { value: [] }),
  );
  await secrets();
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "demo" },
  });
  fireEvent.change(screen.getByLabelText("Upload options"), {
    target: { value: "file" },
  });
  const bytes = new TextEncoder().encode("\ufefffixture\r\n");
  fireEvent.change(screen.getByLabelText("UTF-8 text file"), {
    target: {
      files: [{ size: bytes.length, arrayBuffer: async () => bytes.buffer }],
    },
  });
  await screen.findByText("File ready. Value remains masked.");
  assert.equal(calls.filter((c) => c.method === "PUT").length, 0);
  fireEvent.change(screen.getByLabelText("Value format"), {target:{value:"text"}});
  fireEvent.click(screen.getByRole("button", { name: "Create secret" }));
  await screen.findByText(/Saved to vault/);
  assert.equal(
    calls.find((c) => c.method === "PUT")?.body?.value,
    "\ufefffixture\r\n",
  );
});
test("a late history response cannot repopulate after disconnect", async () => {
  let resolve!: (r: Response) => void;
  setup(async (url) =>
    url.endsWith("/versions")
      ? new Promise((r) => {
          resolve = r;
        })
      : Response.json({ value: [] }),
  );
  await secrets();
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await waitFor(() => assert.ok(resolve));
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await act(async () => resolve(Response.json(versions)));
  assert.equal(screen.queryByText("CURRENT VERSION"), null);
  assert.ok(screen.getByRole("button", { name: "Connect to namespace" }));
});
test("denied list access still allows opening a known name", async () => {
  setup(async (url) =>
    url.endsWith("/versions")
      ? Response.json(versions)
      : Response.json({ error: { code: "Forbidden" } }, { status: 403 }),
  );
  await secrets();
  await screen.findByText(/Permission denied/);
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await screen.findByText("CURRENT VERSION");
  assert.equal(screen.queryByText(/Permission denied/), null);
});
test("an existing date cannot be cleared while metadata remains editable", async () => {
  const dated = {
    value: [
      {
        id: id + "v1",
        attributes: {
          enabled: true,
          created: 1,
          updated: 1,
          nbf: 100,
          exp: 200,
        },
      },
    ],
  };
  setup(async () => Response.json(dated));
  await secrets();
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await screen.findByText("CURRENT VERSION");
  fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
  await screen.findByRole("button", { name: "Save metadata" });
  assert.equal(
    (screen.getByLabelText("Set activation date") as HTMLInputElement).disabled,
    true,
  );
  assert.equal(
    (screen.getByLabelText("Set expiration date") as HTMLInputElement).disabled,
    true,
  );
  assert.ok(screen.getByText(/Existing activation date can be changed/));
});
test("unsaved dialog traps keyboard focus and Escape preserves input", async () => {
  setup();
  await secrets();
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "dirty" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Keys" }));
  const stay = screen.getByRole("button", { name: "Stay" }),
    discard = screen.getByRole("button", { name: "Discard changes" });
  discard.focus();
  fireEvent.keyDown(discard, { key: "Tab" });
  assert.equal(document.activeElement, stay);
  fireEvent.keyDown(stay, { key: "Escape" });
  assert.equal(screen.queryByRole("alertdialog"), null);
  assert.equal(
    (screen.getByLabelText("Name") as HTMLInputElement).value,
    "dirty",
  );
});
test("a pending write disables fields and prevents duplicate submission", async () => {
  let resolve!: (r: Response) => void;
  setup(async (url, init) =>
    init?.method === "PUT"
      ? new Promise((r) => {
          resolve = r;
        })
      : Response.json(url.endsWith("/versions") ? versions : { value: [] }),
  );
  await secrets();
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "demo" },
  });
  fireEvent.change(screen.getByLabelText("Secret value"), {
    target: { value: "original" },
  });
  fireEvent.change(screen.getByLabelText("Value format"), {target:{value:"text"}});
  fireEvent.click(screen.getByRole("button", { name: "Create secret" }));
  await waitFor(() => assert.ok(resolve));
  assert.equal(
    (screen.getByLabelText("Name") as HTMLInputElement).closest("fieldset")
      ?.disabled,
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
  await act(async () =>
    resolve(Response.json({ id: id + "v3", value: "echo" })),
  );
  await screen.findByText(/Saved to vault/);
});
test("opening a create form cancels pending history so late metadata cannot discard typed input", async () => {
  let resolve!: (r: Response) => void;
  setup(async (url) =>
    url.endsWith("/versions")
      ? new Promise((r) => {
          resolve = r;
        })
      : Response.json({ value: [] }),
  );
  await secrets();
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await waitFor(() => assert.ok(resolve));
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Secret value"), {
    target: { value: "keep-me" },
  });
  await act(async () => resolve(Response.json(versions)));
  assert.equal(
    (screen.queryByLabelText("Secret value") as HTMLInputElement | null)?.value,
    "keep-me",
  );
});
test("metadata dates outside browser date range remain readable and are preserved on save", async () => {
  const far = Number.MAX_SAFE_INTEGER;
  setup(async (url, init) =>
    init?.method === "PATCH"
      ? Response.json({ id: id + "v1", attributes: { enabled: true } })
      : Response.json(
          url.endsWith("/versions")
            ? {
                value: [
                  {
                    id: id + "v1",
                    attributes: {
                      enabled: true,
                      created: 1,
                      updated: 1,
                      exp: far,
                    },
                  },
                ],
              }
            : { value: [] },
        ),
  );
  await secrets();
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await screen.findByText("CURRENT VERSION");
  fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
  await screen.findByRole("button", { name: "Save metadata" });
  assert.ok(screen.getByText(/outside the date control range/));
  fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));
  await screen.findByText(/Saved to vault/);
  assert.equal(
    (
      calls.find((c) => c.method === "PATCH")?.body?.attributes as Record<
        string,
        unknown
      >
    ).exp,
    far,
  );
});
test("discarding through the current section resets its sensitive form too", async () => {
  setup();
  await secrets();
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  fireEvent.change(screen.getByLabelText("Secret value"), {
    target: { value: "discard-me" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Secrets (Azure-style)" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  assert.equal(
    (screen.queryByLabelText("Secret value") as HTMLInputElement | null)
      ?.value ?? "",
    "",
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate/Import" }));
  assert.equal(
    (screen.getByLabelText("Secret value") as HTMLInputElement).value,
    "",
  );
});
test("shows purpose as name while opening the physical resource and searching either field", async () => {
  const physical = "hashed-secret";
  setup(async (url) =>
    url.endsWith("/versions")
      ? Response.json({ value: [] })
      : Response.json({
          value: [
            {
              name: physical,
              kind: "secret",
              id: id.replace("/demo/", `/${physical}`),
              version: "v1",
              versionId: id.replace("/demo/", `/${physical}/`) + "v1",
              attributes: { enabled: true },
              tags: { purpose: "Database password" },
              purpose: "Database password",
            },
          ],
        }),
  );
  await secrets();
  const button = await screen.findByRole("button", {
    name: "Database password",
  });
  assert.ok(screen.getByText(physical));
  fireEvent.click(button);
  await waitFor(() =>
    assert.ok(
      calls.some((c) => c.url.endsWith("/secrets/hashed-secret/versions")),
    ),
  );
  fireEvent.change(screen.getByLabelText("Search by name or purpose"), {
    target: { value: "BASE pass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() =>
    assert.ok(
      calls.some(
        (c) =>
          new URL(c.url, "http://localhost").searchParams.get("search") ===
          "BASE pass",
      ),
    ),
  );
});
test("selected secret version can be revealed and metadata editor starts hidden without another value read", async () => {
  setup(async (url) =>
    url.endsWith("/versions")
      ? Response.json(versions)
      : url.endsWith("/secrets/demo/v1")
        ? Response.json({
            id: id + "v1",
            value: "synthetic-selected-value",
            attributes: { enabled: true },
          })
        : Response.json({ value: [] }),
  );
  await secrets();
  fireEvent.click(screen.getByText("Open by name…").closest("summary")!);
  fireEvent.change(screen.getByLabelText("Open by name"), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open versions" }));
  await screen.findByText("CURRENT VERSION");
  fireEvent.click(screen.getByRole("button", { name: "Version v1" }));
  assert.equal(
    calls.some((c) => c.url.endsWith("/secrets/demo/v1")),
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  await screen.findByRole("button", { name: "Hide secret value" });
  assert.equal(
    (
      screen.getByLabelText(
        "Selected version secret value",
      ) as HTMLTextAreaElement
    ).value,
    "synthetic-selected-value",
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
  await screen.findByRole("button", { name: "Save metadata" });
  assert.ok(screen.getByRole("button", { name: "Show secret value" }));
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
  assert.equal(
    calls.filter((c) => c.url.endsWith("/secrets/demo/v1")).length,
    1,
  );
});
test("typing searches after three characters without clearing the existing rows first", async () => {
  const row = {
    name: "physical",
    kind: "secret",
    id: id.replace("/demo/", "/physical"),
    version: "v1",
    versionId: id.replace("/demo/", "/physical/") + "v1",
    versionCount: 3,
    attributes: { enabled: true },
    tags: { purpose: "Initial row" },
  };
  setup(async () => Response.json({ value: [row] }));
  await secrets();
  await screen.findByRole("button", { name: "Initial row" });
  assert.ok(screen.getByRole("columnheader", { name: "Versions" }));
  const count = calls.length;
  fireEvent.change(screen.getByLabelText("Search by name or purpose"), {
    target: { value: "cl" },
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(calls.length, count);
  assert.ok(screen.getByRole("button", { name: "Initial row" }));
  fireEvent.change(screen.getByLabelText("Search by name or purpose"), {
    target: { value: "clerk" },
  });
  assert.ok(screen.getByRole("button", { name: "Initial row" }));
  await waitFor(() =>
    assert.ok(
      calls.some(
        (c) =>
          new URL(c.url, "http://localhost").searchParams.get("search") ===
          "clerk",
      ),
    ),
  );
  fireEvent.change(screen.getByLabelText("Search by name or purpose"), {
    target: { value: "" },
  });
  await waitFor(() => assert.ok(calls.length > count + 1));
});
test("secret rows provide hidden copy and display metadata version counts", async () => {
  let copied = "";
  const row = {
    name: "demo",
    kind: "secret",
    id: id.slice(0, -1).replace("/demo", "/demo"),
    version: "v1",
    versionId: id + "v1",
    versionCount: 2,
    attributes: { enabled: true },
    tags: { purpose: "Demo secret" },
  };
  row.id = "http://127.0.0.1:4000/namespaces/development/club-a/secrets/demo";
  setup(async (url) =>
    url.endsWith("/demo/v1")
      ? Response.json({
          id: id + "v1",
          value: "row-secret",
          attributes: { enabled: true },
        })
      : Response.json({ value: [row] }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied = value;
      },
    },
  });
  await secrets();
  const button = await screen.findByRole("button", {
    name: "Copy secret value for Demo secret (demo)",
  });
  assert.ok(screen.getByRole("columnheader", { name: "Copy" }));
  assert.ok(screen.getByRole("cell", { name: "2" }));
  assert.equal(
    calls.some((c) => c.url.endsWith("/demo/v1")),
    false,
  );
  fireEvent.click(button);
  await screen.findByText("Copied");
  assert.equal(copied, "row-secret");
  assert.equal(document.body.textContent?.includes("row-secret"), false);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});
test("older API missing version count uses metadata history without reading secret values", async () => {
  const row = {
    name: "demo",
    kind: "secret",
    id: "http://127.0.0.1:4000/namespaces/development/club-a/secrets/demo",
    version: "v2",
    versionId: id + "v2",
    attributes: { enabled: true },
  };
  setup(async (url) =>
    Response.json(url.endsWith("/versions") ? versions : { value: [row] }),
  );
  await secrets();
  await screen.findByRole("cell", { name: "2" });
  assert.equal(
    calls.some((c) => c.url.endsWith("/demo/v2")),
    false,
  );
});

test('secret create requires an explicit format and submits hex text unchanged',async()=>{
  setup(async(url,init)=>init?.method==='PUT'?Response.json({id:id+'v3',attributes:{enabled:true},valueFormat:'hex64'}):Response.json(url.endsWith('/versions')?versions:{value:[]}));
  await secrets();fireEvent.click(screen.getByRole('button',{name:'Generate/Import'}));
  const format=screen.getByLabelText('Value format') as HTMLSelectElement;
  assert.equal(format.value,'');assert.equal(format.required,true);
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'demo'}});
  const value='aB01'.repeat(16);fireEvent.change(screen.getByLabelText('Secret value'),{target:{value}});
  fireEvent.change(format,{target:{value:'hex64'}});fireEvent.click(screen.getByRole('button',{name:'Create secret'}));
  await screen.findByText(/Saved to vault/);assert.equal(calls.find(c=>c.method==='PUT')?.body?.valueFormat,'hex64');assert.equal(calls.find(c=>c.method==='PUT')?.body?.value,value);
});
test('signed-in inventory requests allow the cold authentication startup budget',async()=>{
 const original=AbortSignal.timeout;const budgets:number[]=[];
 AbortSignal.timeout=(milliseconds:number)=>{budgets.push(milliseconds);return original(60000);};
 try{setup();await secrets();await screen.findByRole('button',{name:'Refresh list'});assert.ok(budgets.length>=2);assert.ok(budgets.every(ms=>ms>=20000),'connection and list must include the authentication startup budget');}finally{AbortSignal.timeout=original;}
});
test('inventory timeout gives a retry instruction instead of a raw signal error',async()=>{
 setup(async()=>{throw new DOMException('signal timed out','TimeoutError');});await secrets();const alert=await screen.findByRole('alert');assert.match(alert.textContent??'',/request timed out.*retry/i);assert.equal(alert.textContent?.includes('signal timed out'),false);
});
