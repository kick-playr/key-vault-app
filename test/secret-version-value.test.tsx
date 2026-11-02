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
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { render, screen, fireEvent, cleanup, act, waitFor } = await import(
  "@testing-library/react"
);
const { SecretVersionValue } = await import(
  "../src/components/secret-version-value"
);
const connection = {
  environment: "development",
  tenant: "club-a",
  token: "synthetic-read-token-1234567890123456",
};
const id =
  "http://127.0.0.1:4000/namespaces/development/club-a/secrets/demo/v1";
const originalFetch = globalThis.fetch;
const originalClipboardItem = globalThis.ClipboardItem;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: originalClipboardItem,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});
function panel(version = "v1") {
  return (
    <SecretVersionValue
      key={version}
      connection={connection}
      name="demo"
      version={version}
      onUnauthorized={() => {}}
    />
  );
}
test("value is fetched only on explicit action, exact version stays scoped and Copy preserves original bytes", async () => {
  let calls = 0,
    copied = "";
  const secret = "\ufeffline1\r\nline2";
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "/api/vault/secrets/demo/v1");
    assert.equal(new Headers(init?.headers).get("x-vault-tenant"), "club-a");
    assert.equal(
      new Headers(init?.headers).get("x-vault-environment"),
      "development",
    );
    assert.equal(init?.cache, "no-store");
    return Response.json({ id, value: secret, attributes: { enabled: true } });
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (v: string) => {
        copied = v;
      },
    },
  });
  render(panel());
  assert.equal(calls, 0);
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Copy secret value",
      }) as HTMLButtonElement
    ).disabled,
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
    secret.replaceAll("\r\n", "\n"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy secret value" }));
  await screen.findByText(/Copied/);
  assert.equal(copied, secret);
  fireEvent.click(screen.getByRole("button", { name: "Hide secret value" }));
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  await screen.findByRole("button", { name: "Hide secret value" });
  assert.equal(calls, 2);
});
test("late reveal cannot repopulate a different selected version", async () => {
  let resolve!: (r: Response) => void;
  globalThis.fetch = async () =>
    new Promise((r) => {
      resolve = r;
    });
  const view = render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  view.rerender(panel("v2"));
  await act(async () =>
    resolve(
      Response.json({ id, value: "stale", attributes: { enabled: true } }),
    ),
  );
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
  assert.equal(document.body.textContent?.includes("stale"), false);
});
test("read denial stays masked and does not echo upstream response", async () => {
  globalThis.fetch = async () =>
    Response.json({ error: { message: "never-echo" } }, { status: 403 });
  render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  await screen.findByRole("alert");
  assert.equal(document.body.textContent?.includes("never-echo"), false);
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
});
test("rejects a response for a foreign exact version and handles clipboard denial", async () => {
  globalThis.fetch = async () =>
    Response.json({
      id: id.replace("/v1", "/v2"),
      value: "wrong-version",
      attributes: { enabled: true },
    });
  render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  await screen.findByRole("alert");
  assert.equal(document.body.textContent?.includes("wrong-version"), false);
  globalThis.fetch = async () =>
    Response.json({ id, value: "fixture", attributes: { enabled: true } });
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  await screen.findByRole("button", { name: "Hide secret value" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw Error("private-error");
      },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Copy secret value" }));
  await screen.findByText(/Could not copy/);
  assert.equal(document.body.textContent?.includes("private-error"), false);
});
test("Copy reads a hidden value on demand without revealing or retaining it", async () => {
  let copied = "",
    calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      id,
      value: "hidden\r\nvalue",
      attributes: { enabled: true },
    });
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied = text;
      },
    },
  });
  render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Copy secret value" }));
  await screen.findByText(/Copied/);
  assert.equal(copied, "hidden\r\nvalue");
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
  assert.equal(
    screen.queryByRole("button", { name: "Hide secret value" }),
    null,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  await screen.findByRole("button", { name: "Hide secret value" });
  assert.equal(calls, 2);
});
test("a hidden copy request cannot copy a response after switching versions", async () => {
  let resolve!: (r: Response) => void,
    copies = 0;
  globalThis.fetch = async () =>
    new Promise((r) => {
      resolve = r;
    });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        copies++;
      },
    },
  });
  const view = render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Copy secret value" }));
  view.rerender(panel("v2"));
  await act(async () =>
    resolve(Response.json({ id, value: "old", attributes: { enabled: true } })),
  );
  assert.equal(copies, 0);
  assert.equal(screen.queryByText(/Copied/), null);
});
test("hidden-copy read denial leaves the value hidden and never writes clipboard", async () => {
  let copies = 0;
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "sensitive-upstream" } },
      { status: 403 },
    );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        copies++;
      },
    },
  });
  render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Copy secret value" }));
  await screen.findByRole("alert");
  assert.equal(copies, 0);
  assert.equal(
    document.body.textContent?.includes("sensitive-upstream"),
    false,
  );
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
});
test("hidden copying starts clipboard write inside the click while the read is pending", async () => {
  let resolve!: (r: Response) => void,
    started = false,
    copied = "";
  globalThis.fetch = async () =>
    new Promise((r) => {
      resolve = r;
    });
  class TestClipboardItem {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: TestClipboardItem,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write: async (items: TestClipboardItem[]) => {
        started = true;
        copied = await (await items[0]!.data["text/plain"]!).text();
      },
    },
  });
  render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Copy secret value" }));
  assert.equal(started, true);
  await act(async () =>
    resolve(
      Response.json({
        id,
        value: "exact\r\nvalue",
        attributes: { enabled: true },
      }),
    ),
  );
  await screen.findByText(/Copied/);
  assert.equal(copied, "exact\r\nvalue");
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
});
test("a revealed value can still be hidden while clipboard permission is pending", async () => {
  let finishCopy!: () => void;
  globalThis.fetch = async () =>
    Response.json({
      id,
      value: "fixture-to-hide",
      attributes: { enabled: true },
    });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    },
  });
  render(panel());
  fireEvent.click(screen.getByRole("button", { name: "Show secret value" }));
  await screen.findByRole("button", { name: "Hide secret value" });
  fireEvent.click(screen.getByRole("button", { name: "Copy secret value" }));
  await waitFor(() => assert.equal(typeof finishCopy, "function"));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Hide secret value",
      }) as HTMLButtonElement
    ).disabled,
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Hide secret value" }));
  assert.equal(
    (screen.getByLabelText("Selected version secret value") as HTMLInputElement)
      .type,
    "password",
  );
  await act(async () => finishCopy());
  assert.equal(screen.queryByText(/Copied/), null);
});
test("copy icon becomes Copied only after success and returns after exactly three seconds", async (t) => {
  globalThis.fetch = async () =>
    Response.json({ id, value: "fixture", attributes: { enabled: true } });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => {} },
  });
  render(panel());
  const button = screen.getByRole("button", { name: "Copy secret value" });
  assert.ok(button.querySelector("svg"));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await act(async () => fireEvent.click(button));
  assert.equal(button.textContent, "Copied");
  await act(async () => t.mock.timers.tick(2999));
  assert.equal(button.textContent, "Copied");
  await act(async () => t.mock.timers.tick(1));
  assert.ok(button.querySelector("svg"));
  assert.equal(button.textContent, "");
});
