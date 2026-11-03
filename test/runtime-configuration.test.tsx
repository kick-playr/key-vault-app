import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<html><body></body></html>", {
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
const { render, screen, fireEvent, cleanup, waitFor } =
  await import("@testing-library/react");
const { RuntimeConfigurationPanel } =
  await import("../src/components/runtime-configuration-panel");
const { parseConfiguration, exportConfiguration } =
  await import("../src/lib/runtime-configuration");
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
const configuration = {
  kind: "runtime-configuration",
  schemaVersion: 1,
  id: "development",
  applications: {
    "club-api": {
      displayName: "Club API",
      description: "",
      secrets: [{ purpose: "mongo", mapping: "MONGO_URI", version: "latest" }],
    },
    app: { displayName: "Club APP", description: "", secrets: [] },
    explorer: { displayName: "Explorer APP", description: "", secrets: [] },
    "explorer-api": {
      displayName: "Explorer API",
      description: "",
      secrets: [],
    },
  },
  tenants: [],
};
const connection = {
  environment: "development",
  tenant: "_shared",
  token: "fixture-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
test("metadata serialization preserves Latest and rejects credential fields", () => {
  assert.deepEqual(
    JSON.parse(
      exportConfiguration(parseConfiguration(configuration, "development")),
    ),
    configuration,
  );
  assert.throws(() =>
    parseConfiguration({ ...configuration, token: "private" }, "development"),
  );
});
test("loads existing tenant with ephemeral grant, assigns consumer and saves metadata without asserting Ready", async () => {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    if (path.endsWith("/tenants/fcrww"))
      return Response.json({
        tenant: "fcrww",
        generation: 4,
        secrets: [
          {
            purpose: "database",
            mapping: "TENANT_DB",
            version: "a".repeat(32),
          },
        ],
        keySets: [],
      });
    if (init?.method === "PUT")
      return Response.json({
        revision: 2,
        configuration: JSON.parse(String(init.body)).configuration,
      });
    return Response.json({ revision: 1, configuration });
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.change(screen.getByLabelText("Existing tenant slug"), {
    target: { value: "fcrww" },
  });
  fireEvent.change(screen.getByLabelText("Tenant grant (optional)"), {
    target: { value: "tenant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  });
  fireEvent.click(screen.getByText("Load tenant"));
  await screen.findByLabelText("Club API consumes fcrww");
  assert.equal(
    (screen.getByLabelText("Tenant grant (optional)") as HTMLInputElement)
      .value,
    "",
  );
  fireEvent.click(screen.getByLabelText("Club API consumes fcrww"));
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Saved configuration.*consumer reports/i);
  const save = calls.find((c) => c.init?.method === "PUT")!;
  const body = JSON.parse(String(save.init?.body));
  assert.deepEqual(body.configuration.tenants[0].applications, ["club-api"]);
  assert.deepEqual(body.expectedGenerations, { fcrww: 4 });
  assert.equal(String(save.init?.body).includes("tenant-aaaa"), false);
  assert.equal(
    new Headers(save.init?.headers).get("x-vault-tenant-tokens"),
    JSON.stringify({ fcrww: "tenant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
  );
  assert.equal(dom.window.localStorage.length, 0);
});
test("import stages preview and cancel leaves the draft unchanged", async () => {
  globalThis.fetch = async (input) =>
    Response.json(
      String(input).endsWith("/import")
        ? {
            configuration: {
              ...configuration,
              tenants: [
                {
                  tenant: "other",
                  applications: ["app"],
                  secrets: [],
                  keySets: [],
                },
              ],
            },
          }
        : { revision: 1, configuration },
    );
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.change(screen.getByLabelText("Import configuration JSON"), {
    target: { value: JSON.stringify(configuration) },
  });
  fireEvent.click(screen.getByText("Preview import"));
  await screen.findByRole("dialog", { name: "Review imported configuration" });
  fireEvent.click(screen.getByText("Cancel import"));
  assert.equal(screen.queryByLabelText("Club APP consumes other"), null);
});
test("retains key history controls, blocks invalid drafts and guards reload cancellation", async () => {
  const keySets = [
    {
      reference: "profile/default",
      currentWrappingVersion: "v1",
      mappings: { wrapping: "WRAP", index: "INDEX", control: "CONTROL" },
      wrappingVersions: [{ keyVersion: "v1", vaultVersion: "a".repeat(32) }],
      indexVersion: "latest",
      controlVersion: "b".repeat(32),
    },
  ];
  globalThis.fetch = async () =>
    Response.json({
      revision: 1,
      configuration: {
        ...configuration,
        tenants: [
          { tenant: "fcrww", applications: ["club-api"], secrets: [], keySets },
        ],
      },
    });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("fcrww");
  fireEvent.click(screen.getByText("fcrww"));
  fireEvent.click(screen.getByText("Retain another wrapping version"));
  assert.equal(screen.getAllByLabelText("Wrapping label").length, 2);
  fireEvent.click(screen.getByText("Reload configuration"));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByText("Stay"));
  assert.equal(screen.getAllByLabelText("Wrapping label").length, 2);
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByRole("alert");
});
test("409 keeps the draft and disables repeat Save until reload", async () => {
  globalThis.fetch = async (_input, init) =>
    init?.method === "PUT"
      ? Response.json({ error: { code: "RevisionConflict" } }, { status: 409 })
      : Response.json({ revision: 1, configuration });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.click(screen.getByText("Club API"));
  fireEvent.change(screen.getByLabelText("ENV mapping"), {
    target: { value: "OTHER" },
  });
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Revision conflict/);
  assert.equal(
    (screen.getByText("Save configuration") as HTMLButtonElement).disabled,
    true,
  );
  assert.equal(
    (screen.getByLabelText("ENV mapping") as HTMLInputElement).value,
    "OTHER",
  );
});
test("binding adoption requires a fresh scoped consumer report rather than a metadata save", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push(path);
    if (path.includes("/status")) {
      assert.equal(new Headers(init?.headers).get("x-vault-tenant"), "fcrww");
      return Response.json({
        state: "applied",
        instances: [
          {
            instanceId: "fixture",
            lastSeen: Date.now(),
            expiresAt: Date.now() + 60000,
            status: "applied",
          },
        ],
      });
    }
    return Response.json({
      revision: 1,
      publicationId: "published-fixture",
      configuration: {
        ...configuration,
        tenants: [
          {
            tenant: "fcrww",
            applications: ["club-api"],
            secrets: [],
            keySets: [],
          },
        ],
      },
    });
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("fcrww");
  fireEvent.click(screen.getByText("fcrww"));
  await screen.findByText("Club API: Bindings adopted (consumer reported)");
  assert.ok(screen.getByText(/reports Vault binding adoption only/));
  assert.ok(calls.includes("/api/vault/local/applications/club-api/status"));
});

test("successful Save consumes reviewed generations so later changes do not send stale counters", async () => {
  const generations: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/tenants/fcrww"))
      return Response.json({
        tenant: "fcrww",
        generation: 4,
        secrets: [],
        keySets: [],
      });
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      generations.push(body.expectedGenerations);
      return Response.json({
        revision: generations.length + 1,
        configuration: body.configuration,
      });
    }
    return Response.json({ revision: 1, configuration });
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.change(screen.getByLabelText("Existing tenant slug"), {
    target: { value: "fcrww" },
  });
  fireEvent.click(screen.getByText("Load tenant"));
  await screen.findByLabelText("Club API consumes fcrww");
  fireEvent.click(screen.getByLabelText("Club API consumes fcrww"));
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Saved configuration/);
  fireEvent.click(screen.getByLabelText("Club APP consumes fcrww"));
  fireEvent.click(screen.getByText("Save configuration"));
  await waitFor(() => assert.equal(generations.length, 2));
  assert.deepEqual(generations, [{ fcrww: 4 }, {}]);
});

test("freezes configuration controls while a save is in flight", async () => {
  let finish: ((v: Response) => void) | undefined;
  globalThis.fetch = async (_input, init) =>
    init?.method === "PUT"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Response.json({ revision: 1, configuration });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.click(screen.getByText("Club API"));
  fireEvent.change(screen.getByLabelText("ENV mapping"), {
    target: { value: "CHANGED" },
  });
  fireEvent.click(screen.getByText("Save configuration"));
  assert.ok(
    (screen.getByLabelText("ENV mapping") as HTMLInputElement).matches(
      ":disabled",
    ),
  );
  finish?.(Response.json({ revision: 2, configuration }));
  await screen.findByText(/Saved configuration/);
});

test("legacy import leaves omitted versions unresolved until Save returns actual immutable pins", async () => {
  const draft = {
    ...configuration,
    applications: {
      "club-api": {
        displayName: "Club API",
        description: "",
        secrets: [{ purpose: "mongo", mapping: "MONGO_URI" }],
      },
    },
  };
  globalThis.fetch = async (input, init) =>
    String(input).endsWith("/import")
      ? Response.json({ configuration: draft })
      : init?.method === "PUT"
        ? Response.json({
            revision: 2,
            configuration: {
              ...draft,
              applications: {
                "club-api": {
                  ...draft.applications["club-api"],
                  secrets: [
                    {
                      purpose: "mongo",
                      mapping: "MONGO_URI",
                      version: "a".repeat(32),
                    },
                  ],
                },
              },
            },
          })
        : Response.json({ revision: 1, configuration });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.change(screen.getByLabelText("Import configuration JSON"), {
    target: { value: JSON.stringify({ schemaVersion: 1 }) },
  });
  fireEvent.click(screen.getByText("Preview import"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByText("Use imported draft"));
  fireEvent.click(screen.getByText("Club API"));
  assert.equal(
    (
      screen.getByLabelText(
        "Version (latest or immutable pin)",
      ) as HTMLInputElement
    ).value,
    "",
  );
  assert.ok(
    screen.getByPlaceholderText("Choose version — unresolved legacy selection"),
  );
  fireEvent.click(screen.getByText("Export configuration"));
  await screen.findByRole("alert");
  assert.equal(screen.queryByLabelText("Metadata-only export"), null);
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Saved configuration/);
  fireEvent.click(screen.getByText("Export configuration"));
  assert.ok(
    (
      screen.getByLabelText("Metadata-only export") as HTMLTextAreaElement
    ).value.includes("a".repeat(32)),
  );
});

test("export rejects unresolved key-role versions instead of silently losing policies", () => {
  const unresolved = {
    ...configuration,
    tenants: [
      {
        tenant: "fcrww",
        applications: ["club-api"],
        secrets: [],
        keySets: [
          {
            reference: "default",
            currentWrappingVersion: "v1",
            wrappingVersions: [{ keyVersion: "v1" }],
          },
        ],
      },
    ],
  };
  assert.throws(
    () => exportConfiguration(parseConfiguration(unresolved, "development")),
    /key.*version/i,
  );
});

test("malformed import errors do not echo pasted credentials", async () => {
  globalThis.fetch = async () => Response.json({ revision: 1, configuration });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.change(screen.getByLabelText("Import configuration JSON"), {
    target: { value: "SENSITIVE" },
  });
  fireEvent.click(screen.getByText("Preview import"));
  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent?.includes("SENSITIVE"), false);
});

test("loading a bootstrap tenant fills its scoped binding template while preserving assignments", async () => {
  globalThis.fetch = async (input) =>
    String(input).endsWith("/tenants/fcrww")
      ? Response.json({
          tenant: "fcrww",
          generation: 2,
          secrets: [
            {
              purpose: "tenant-db",
              mapping: "TENANT_DB",
              version: "a".repeat(32),
            },
          ],
          keySets: [],
        })
      : Response.json({
          revision: 0,
          configuration: {
            ...configuration,
            tenants: [
              {
                tenant: "fcrww",
                applications: ["club-api"],
                secrets: [],
                keySets: [],
              },
            ],
          },
        });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("fcrww");
  fireEvent.change(screen.getByLabelText("Existing tenant slug"), {
    target: { value: "fcrww" },
  });
  fireEvent.click(screen.getByText("Load tenant"));
  await screen.findByText("tenant-db");
  assert.equal(
    (screen.getByLabelText("Club API consumes fcrww") as HTMLInputElement)
      .checked,
    true,
  );
});

test("runtime access is explicitly confirmed separately from configuration Save", async () => {
  const writes: { path: string; body: unknown }[] = [];
  let authorized = false;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.includes("/runtime-access-control/")) {
      assert.equal(new Headers(init?.headers).get("x-vault-tenant"), "_shared");
      if (init?.method === "PUT") {
        writes.push({ path, body: JSON.parse(String(init.body)) });
        authorized = true;
      }
      return Response.json({
        application: "club-api",
        tenant: "fcrww",
        identityConfigured: true,
        authorized,
      });
    }
    return Response.json({
      revision: 1,
      configuration: {
        ...configuration,
        tenants: [
          {
            tenant: "fcrww",
            applications: ["club-api"],
            secrets: [],
            keySets: [],
          },
        ],
      },
    });
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("fcrww");
  fireEvent.click(screen.getByText("fcrww"));
  await screen.findByText("Runtime access not allowed");
  assert.equal(writes.length, 0);
  fireEvent.click(
    screen.getByRole("button", { name: "Allow runtime access for Club API" }),
  );
  await screen.findByRole("alertdialog", { name: "Allow runtime access" });
  assert.equal(writes.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Cancel access change" }));
  assert.equal(writes.length, 0);
  fireEvent.click(
    screen.getByRole("button", { name: "Allow runtime access for Club API" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm allow runtime access" }),
  );
  await screen.findByText("Runtime access allowed");
  assert.deepEqual(writes, [
    {
      path: "/api/vault/local/runtime-access-control/club-api/tenants/fcrww",
      body: { allow: true },
    },
  ]);
  fireEvent.click(screen.getByText("Export configuration"));
  assert.equal(
    (
      screen.getByLabelText("Metadata-only export") as HTMLTextAreaElement
    ).value.includes("authorized"),
    false,
  );
});
test("missing identity and denied access inspection remain honest", async () => {
  globalThis.fetch = async (input) =>
    String(input).includes("/runtime-access-control/")
      ? Response.json({
          application: "club-api",
          tenant: "fcrww",
          identityConfigured: false,
          authorized: false,
        })
      : Response.json({
          revision: 1,
          configuration: {
            ...configuration,
            tenants: [
              {
                tenant: "fcrww",
                applications: ["club-api"],
                secrets: [],
                keySets: [],
              },
            ],
          },
        });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("fcrww");
  fireEvent.click(screen.getByText("fcrww"));
  await screen.findByText(/One-time runtime identity setup required/);
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Allow runtime access for Club API",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
});

test("denied runtime access inspection does not imply allowed access", async () => {
  globalThis.fetch = async (input) =>
    String(input).includes("/runtime-access-control/")
      ? Response.json({ error: { message: "SENSITIVE" } }, { status: 403 })
      : Response.json({
          revision: 1,
          configuration: {
            ...configuration,
            tenants: [
              {
                tenant: "fcrww",
                applications: ["club-api"],
                secrets: [],
                keySets: [],
              },
            ],
          },
        });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("fcrww");
  fireEvent.click(screen.getByText("fcrww"));
  await screen.findByText(/Existing operator grants need/);
  assert.equal(screen.queryByText("Runtime access allowed"), null);
  assert.equal(
    screen.queryByRole("button", { name: "Allow runtime access for Club API" }),
    null,
  );
  assert.equal(
    dom.window.document.body.textContent?.includes("SENSITIVE"),
    false,
  );
});
test("configuration Save never writes runtime access and scoped grant never enters metadata", async () => {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  const tenantToken = "tenant-operator-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    if (
      path.endsWith("/tenants/fcrww") &&
      path.includes("/runtime-configuration/")
    )
      return Response.json({
        tenant: "fcrww",
        generation: 1,
        secrets: [],
        keySets: [],
      });
    if (path.includes("/runtime-access-control/")) {
      assert.equal(
        new Headers(init?.headers).get("x-vault-tenant-tokens"),
        JSON.stringify({ fcrww: tenantToken }),
      );
      return Response.json({
        application: "club-api",
        tenant: "fcrww",
        identityConfigured: true,
        authorized: false,
      });
    }
    return Response.json({
      revision: init?.method === "PUT" ? 2 : 1,
      configuration: init?.body
        ? JSON.parse(String(init.body)).configuration
        : configuration,
    });
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("Club API");
  fireEvent.change(screen.getByLabelText("Existing tenant slug"), {
    target: { value: "fcrww" },
  });
  fireEvent.change(screen.getByLabelText("Tenant grant (optional)"), {
    target: { value: tenantToken },
  });
  fireEvent.click(screen.getByText("Load tenant"));
  await screen.findByLabelText("Club API consumes fcrww");
  fireEvent.click(screen.getByLabelText("Club API consumes fcrww"));
  await screen.findByText("Runtime access not allowed");
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Saved configuration/);
  assert.equal(
    calls.some(
      (c) =>
        c.path.includes("/runtime-access-control/") && c.init?.method === "PUT",
    ),
    false,
  );
  fireEvent.click(screen.getByText("Export configuration"));
  assert.equal(
    (
      screen.getByLabelText("Metadata-only export") as HTMLTextAreaElement
    ).value.includes(tenantToken),
    false,
  );
  assert.equal(dom.window.localStorage.length, 0);
});

test("an unpublished revision zero seed never implies Ready from earlier reports", async () => {
  globalThis.fetch = async (input) =>
    String(input).includes("/status")
      ? Response.json({
          state: "applied",
          instances: [
            {
              instanceId: "old",
              lastSeen: Date.now(),
              expiresAt: Date.now() + 60000,
              status: "applied",
            },
          ],
        })
      : Response.json({
          revision: 0,
          configuration: {
            ...configuration,
            tenants: [
              {
                tenant: "fcrww",
                applications: ["club-api"],
                secrets: [],
                keySets: [],
              },
            ],
          },
        });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText(/Not published/);
  fireEvent.click(screen.getByText("fcrww"));
  await screen.findByText("Club API: Pending — configuration not published");
  assert.equal(screen.queryByText("Club API: Bindings adopted (consumer reported)"), null);
});

test("Club API provider capability is unchecked by default and sent only after explicit selection", async () => {
  const { RuntimeAccessPanel } =
    await import("../src/components/runtime-access-panel");
  const bodies: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    return Response.json({
      application: "club-api",
      tenant: "fcrww",
      identityConfigured: true,
      authorized: bodies.length > 0,
      oauthAuthorized: bodies.length > 0,
    });
  };
  render(
    <RuntimeAccessPanel
      connection={connection}
      tenant="fcrww"
      tenantToken="tenant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      applications={["club-api"]}
      names={configuration.applications}
    />,
  );
  await screen.findByText("Runtime access not allowed");
  fireEvent.click(
    screen.getByRole("button", { name: "Allow runtime access for Club API" }),
  );
  const check = screen.getByLabelText(
    "Also allow provider credential enrollment and renewal",
  ) as HTMLInputElement;
  assert.equal(check.checked, false);
  fireEvent.click(check);
  fireEvent.click(screen.getByText("Confirm allow runtime access"));
  await screen.findByText("Provider credential enrollment and renewal allowed");
  assert.deepEqual(bodies, [{ allow: true, oauth: true }]);
  fireEvent.click(
    screen.getByRole("button", { name: "Revoke runtime access for Club API" }),
  );
  await screen.findByText(
    /also revokes provider credential enrollment and renewal/,
  );
  fireEvent.click(screen.getByText("Confirm revoke runtime access"));
  await waitFor(() => assert.equal(bodies.length, 2));
  assert.deepEqual(bodies[1], { allow: false });
});
test("frontend access confirmation never offers Club API provider capability", async () => {
  const { RuntimeAccessPanel } =
    await import("../src/components/runtime-access-panel");
  globalThis.fetch = async () =>
    Response.json({
      application: "app",
      tenant: "fcrww",
      identityConfigured: true,
      authorized: false,
    });
  render(
    <RuntimeAccessPanel
      connection={connection}
      tenant="fcrww"
      tenantToken={connection.token}
      applications={["app"]}
      names={configuration.applications}
    />,
  );
  await screen.findByText("Runtime access not allowed");
  fireEvent.click(
    screen.getByRole("button", { name: "Allow runtime access for Club APP" }),
  );
  assert.equal(
    screen.queryByLabelText(
      "Also allow provider credential enrollment and renewal",
    ),
    null,
  );
});
