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
const { render, screen, fireEvent, cleanup, act } = await import(
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
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
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
test("value is not fetched until Show, exact version stays scoped and Copy preserves original bytes", async () => {
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
    true,
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
