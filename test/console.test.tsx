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
async function connect() {
  const resourceFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input) === "/api/vault/local/session"
      ? Response.json({
          authenticated: true,
          environment: "development",
          tenant: "club-a",
        })
      : resourceFetch(input, init);
  fireEvent.change(screen.getByLabelText("Environment"), {
    target: { value: "development" },
  });
  fireEvent.change(screen.getByLabelText("Tenant / namespace"), {
    target: { value: "club-a" },
  });
  fireEvent.change(screen.getByLabelText("Vault bearer token"), {
    target: { value: "fixture-token-for-local-tests-only-12345" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect to namespace" }));
  await screen.findByRole("button", { name: "Disconnect" });
}
const { InventoryPanel } = await import("../src/components/inventory-panel");
const inventoryConnection = {
  environment: "dev",
  tenant: "club-a",
  token: "fixture-token-for-local-tests-only-12345",
};
test("inventory search filters, pagination and exact-version selection stay scoped and metadata only", async () => {
  const calls: string[] = [];
  let selected: unknown;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(new Headers(init?.headers).get("x-vault-tenant"), "club-a");
    const name = calls.length === 1 ? "db-one" : "db-two";
    return Response.json({
      value: [
        {
          name,
          kind: "secret",
          id: `http://127.0.0.1:4000/namespaces/dev/club-a/secrets/${name}`,
          version: "v1",
          versionId: `http://127.0.0.1:4000/namespaces/dev/club-a/secrets/${name}/v1`,
          attributes: { enabled: false, exp: 1 },
          purpose: "database",
          value: "fixture-must-never-render",
        },
      ],
      ...(calls.length === 1
        ? {
            nextLink:
              "http://127.0.0.1:4000/namespaces/dev/club-a/local/inventory?kind=secret&namePrefix=db-&maxresults=1&$skiptoken=abc.def",
          }
        : {}),
    });
  };
  render(
    <InventoryPanel
      connection={inventoryConnection}
      section="secrets"
      revision={0}
      onSelect={(row) => {
        selected = row;
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Inventory source"), {
    target: { value: "search" },
  });
  fireEvent.change(screen.getByLabelText("Name prefix"), {
    target: { value: "db-" },
  });
  fireEvent.change(screen.getByLabelText("Page size"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("db-one");
  assert.match(calls[0]!, /^\/api\/vault\/local\/inventory\?/);
  assert.equal(
    new URL(calls[0]!, "http://local").searchParams.get("kind"),
    "secret",
  );
  assert.equal(screen.queryByText(/fixture-must-never-render/), null);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("db-two");
  assert.ok(calls[1]!.startsWith("/api/vault/local/inventory?"));
  assert.equal(screen.queryByText("db-one"), null);
  fireEvent.click(screen.getByRole("button", { name: "Select db-two" }));
  assert.deepEqual(selected, {
    name: "db-two",
    kind: "secret",
    version: "v1",
    enabled: false,
    expires: 1,
    purpose: "database",
  });
});
test("list permission denial explains independent grants and invalidated pagination offers restart", async () => {
  globalThis.fetch = async () =>
    Response.json({ error: { code: "Forbidden" } }, { status: 403 });
  const rendered = render(
    <InventoryPanel
      connection={inventoryConnection}
      section="keys"
      revision={0}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() =>
    assert.match(
      screen.getByRole("alert").textContent ?? "",
      /list permission/,
    ),
  );
  rendered.unmount();
  let count = 0;
  globalThis.fetch = async () =>
    ++count === 1
      ? Response.json({
          value: [
            {
              kid: "http://127.0.0.1:4000/namespaces/dev/club-a/keys/demo",
              attributes: { enabled: true },
            },
          ],
          nextLink:
            "http://127.0.0.1:4000/namespaces/dev/club-a/keys?api-version=2025-07-01&$skiptoken=abc.def",
        })
      : Response.json(
          { error: { code: "PaginationInvalidated" } },
          { status: 409 },
        );
  render(
    <InventoryPanel
      connection={inventoryConnection}
      section="keys"
      revision={0}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("demo");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() =>
    assert.match(
      screen.getByRole("alert").textContent ?? "",
      /changed.*reload/i,
    ),
  );
  assert.equal(screen.queryByText("demo"), null);
  assert.equal(screen.queryByRole("button", { name: "Next page" }), null);
});
test("late inventory pages cannot refill the view after filters change", async () => {
  let resolve!: (r: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((r) => {
      resolve = r;
    });
  render(
    <InventoryPanel
      connection={inventoryConnection}
      section="keys"
      revision={0}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.change(screen.getByLabelText("Inventory source"), {
    target: { value: "search" },
  });
  await act(async () =>
    resolve(
      Response.json({
        value: [
          {
            kid: "http://127.0.0.1:4000/namespaces/dev/club-a/keys/stale",
            attributes: { enabled: true },
          },
        ],
      }),
    ),
  );
  assert.equal(screen.queryByText("stale"), null);
});
test("does not open the console when a suffixed token fails server authentication", async () => {
  let sent = "";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/vault/local/session");
    sent = new Headers(init?.headers).get("x-vault-token")!;
    return Response.json({ error: { code: "Unauthorized" } }, { status: 401 });
  };
  render(<VaultConsole />);
  fireEvent.change(screen.getByLabelText("Tenant / namespace"), {
    target: { value: "club-a" },
  });
  fireEvent.change(screen.getByLabelText("Vault bearer token"), {
    target: { value: "fixture-token-for-local-tests-only-12345asdfasdfasfs" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect to namespace" }));
  await waitFor(() =>
    assert.match(
      screen.getByRole("alert").textContent ?? "",
      /invalid.*token|token.*invalid/i,
    ),
  );
  assert.equal(sent, "fixture-token-for-local-tests-only-12345asdfasdfasfs");
  assert.equal(screen.queryByRole("button", { name: "Disconnect" }), null);
  assert.equal(screen.queryByLabelText("Resource name"), null);
  assert.equal(
    (screen.getByLabelText("Vault bearer token") as HTMLInputElement).value,
    "",
  );
});
test("connection fails closed for wrong namespace, unavailable API and malformed success responses", async () => {
  const responses = [
    Response.json({ error: { code: "Forbidden" } }, { status: 403 }),
    Response.json({ error: { code: "Unavailable" } }, { status: 503 }),
    Response.json({}),
    Response.json({
      authenticated: true,
      environment: "production",
      tenant: "club-a",
    }),
  ];
  for (const response of responses) {
    globalThis.fetch = async () => response;
    render(<VaultConsole />);
    fireEvent.change(screen.getByLabelText("Tenant / namespace"), {
      target: { value: "club-a" },
    });
    fireEvent.change(screen.getByLabelText("Vault bearer token"), {
      target: { value: "fixture-token-for-local-tests-only-12345" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect to namespace" }),
    );
    await screen.findByRole("alert");
    assert.equal(screen.queryByRole("button", { name: "Disconnect" }), null);
    assert.equal(screen.queryByLabelText("Resource name"), null);
    cleanup();
  }
});
test("connection stays locked until server proof arrives and cancelled proof cannot reconnect", async () => {
  let resolve!: (r: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((r) => {
      resolve = r;
    });
  render(<VaultConsole />);
  fireEvent.change(screen.getByLabelText("Tenant / namespace"), {
    target: { value: "club-a" },
  });
  fireEvent.change(screen.getByLabelText("Vault bearer token"), {
    target: { value: "fixture-token-for-local-tests-only-12345" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect to namespace" }));
  assert.equal(screen.queryByLabelText("Resource name"), null);
  assert.equal(screen.queryByRole("button", { name: "Disconnect" }), null);
  assert.equal(
    (
      screen.getByRole("button", {
        name: /Verifying token/,
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
  await act(async () =>
    resolve(
      Response.json({
        authenticated: true,
        environment: "development",
        tenant: "club-a",
      }),
    ),
  );
  assert.equal(screen.queryByRole("button", { name: "Disconnect" }), null);
  assert.equal(
    (screen.getByLabelText("Vault bearer token") as HTMLInputElement).value,
    "",
  );
});
test("connected namespace and disconnect live once in the top bar", async () => {
  globalThis.fetch = async () => Response.json({});
  render(<VaultConsole />);
  await connect();
  assert.ok(screen.getByRole("heading", { name: "Runtime configuration", level: 1 }));
  assert.equal(screen.getByRole("button", { name: "Runtime configuration" }).getAttribute("aria-current"), "page");
  assert.ok(screen.getByRole("button", { name: "Assigned applications" }));
  assert.equal(screen.queryByRole("button", { name: "Applications" }), null);
  const header = screen.getByRole("banner");
  assert.ok(header.querySelector('[aria-label="Active vault context"]'));
  assert.equal(header.querySelectorAll("button").length, 1);
  assert.match(header.textContent ?? "", /development.*club-a/);
  assert.equal(screen.getAllByRole("button", { name: "Disconnect" }).length, 1);
  assert.equal(
    screen
      .getByRole("main")
      .querySelector('[aria-label="Active vault context"]'),
    null,
  );
});

test("inventory action changes from Search to Refresh and resets when filters change", async () => {
  globalThis.fetch = async () => Response.json({ value: [] });
  render(
    <InventoryPanel
      connection={inventoryConnection}
      section="keys"
      revision={0}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByRole("button", { name: "Refresh" });
  fireEvent.change(screen.getByLabelText("Inventory source"), {
    target: { value: "search" },
  });
  assert.ok(screen.getByRole("button", { name: "Search" }));
  assert.equal(screen.queryByRole("button", { name: "Refresh" }), null);
});
