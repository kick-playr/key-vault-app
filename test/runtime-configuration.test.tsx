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
function resolveReferences(refs: any) {
  return {
    ...configuration,
    applications: Object.fromEntries(
      refs.applications.map((slug: string) => [
        slug,
        configuration.applications[
          slug as keyof typeof configuration.applications
        ],
      ]),
    ),
    tenants: refs.tenants.map((t: any) => ({ ...t, secrets: [], keySets: [] })),
  };
}
test("export contains only schema2 application and tenant references", () => {
  const preview = {
    ...configuration,
    tenants: [
      {
        tenant: "fcrww",
        applications: ["club-api"],
        secrets: [
          { purpose: "db", mapping: "TENANT_DB", version: "a".repeat(32) },
        ],
        keySets: [],
      },
    ],
  };
  const exported = JSON.parse(
    exportConfiguration(parseConfiguration(preview, "development")),
  );
  assert.deepEqual(exported, {
    kind: "runtime-configuration",
    schemaVersion: 2,
    id: "development",
    applications: ["club-api", "app", "explorer", "explorer-api"],
    tenants: [{ tenant: "fcrww", applications: ["club-api"] }],
  });
  assert.equal(JSON.stringify(exported).includes("MONGO_URI"), false);
});
test("canonical bindings are read-only and Save sends reference-only selections", async () => {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    if (
      path.endsWith("/tenants/fcrww") &&
      path.includes("/runtime-configuration/")
    )
      return Response.json({
        tenant: "fcrww",
        generation: 4,
        secrets: [
          {
            purpose: "tenant-db",
            mapping: "TENANT_DB",
            version: "a".repeat(32),
          },
        ],
        keySets: [],
      });
    if (init?.method === "PUT")
      return Response.json({
        revision: 2,
        publicationId: "published",
        configuration: resolveReferences(
          JSON.parse(String(init.body)).configuration,
        ),
      });
    return Response.json({ revision: 1, configuration });
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("MONGO_URI");
  assert.equal(screen.queryByLabelText("ENV mapping"), null);
  assert.equal(screen.queryByText("Add secret binding"), null);
  assert.ok(screen.getByText("Inherited from Applications"));
  fireEvent.change(screen.getByLabelText("Existing tenant slug"), {
    target: { value: "fcrww" },
  });
  fireEvent.change(screen.getByLabelText("Tenant grant (optional)"), {
    target: { value: "tenant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  });
  fireEvent.click(screen.getByText("Load tenant"));
  await screen.findByText("TENANT_DB");
  fireEvent.click(screen.getByLabelText("Club API consumes fcrww"));
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Saved configuration/);
  const body = JSON.parse(
    String(calls.find((c) => c.init?.method === "PUT")!.init?.body),
  );
  assert.equal(body.configuration.schemaVersion, 2);
  assert.deepEqual(body.configuration.tenants, [
    { tenant: "fcrww", applications: ["club-api"] },
  ]);
  assert.equal(JSON.stringify(body.configuration).includes("secrets"), false);
  assert.equal(
    JSON.stringify(body.configuration).includes("tenant-aaaa"),
    false,
  );
});
test("legacy and schema2 imports stage canonical assignment previews and cancellation is safe", async () => {
  const preview = {
    ...configuration,
    tenants: [
      { tenant: "other", applications: ["app"], secrets: [], keySets: [] },
    ],
  };
  globalThis.fetch = async (input) =>
    Response.json(
      String(input).endsWith("/import")
        ? { configuration: preview }
        : { revision: 1, configuration },
    );
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("MONGO_URI");
  fireEvent.change(screen.getByLabelText("Import configuration JSON"), {
    target: {
      value: JSON.stringify({
        schemaVersion: 1,
        applications: { app: { secrets: [{ mapping: "STALE" }] } },
      }),
    },
  });
  fireEvent.click(screen.getByText("Preview import"));
  await screen.findByRole("dialog");
  assert.ok(screen.getByText(/assignments only/));
  fireEvent.click(screen.getByText("Cancel import"));
  assert.equal(screen.queryByText("other"), null);
  fireEvent.change(screen.getByLabelText("Import configuration JSON"), {
    target: {
      value: JSON.stringify({
        kind: "runtime-configuration",
        schemaVersion: 2,
        id: "development",
        applications: ["app"],
        tenants: [{ tenant: "other", applications: ["app"] }],
      }),
    },
  });
  fireEvent.click(screen.getByText("Preview import"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByText("Use imported draft"));
  assert.ok(screen.getByText("other"));
  fireEvent.click(screen.getByText("Export configuration"));
  assert.equal(
    JSON.parse(
      (screen.getByLabelText("Metadata-only export") as HTMLTextAreaElement)
        .value,
    ).schemaVersion,
    2,
  );
});
test("assignment edits preserve dirty cancellation and revision conflict guards", async () => {
  globalThis.fetch = async (_input, init) =>
    init?.method === "PUT"
      ? Response.json({ error: { code: "RevisionConflict" } }, { status: 409 })
      : Response.json({ revision: 1, configuration });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByLabelText("Include Club APP");
  fireEvent.click(screen.getByLabelText("Include Club APP"));
  fireEvent.click(screen.getByText("Reload configuration"));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByText("Stay"));
  assert.equal(
    (screen.getByLabelText("Include Club APP") as HTMLInputElement).checked,
    false,
  );
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Revision conflict/);
  assert.equal(
    (screen.getByText("Save configuration") as HTMLButtonElement).disabled,
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
        ? resolveReferences(JSON.parse(String(init.body)).configuration)
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
  assert.equal(
    screen.queryByText("Club API: Bindings adopted (consumer reported)"),
    null,
  );
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

test("available catalog apps can be included without copying their canonical definitions", async () => {
  globalThis.fetch = async () =>
    Response.json({
      revision: 1,
      configuration: {
        ...configuration,
        applications: { "club-api": configuration.applications["club-api"] },
      },
      availableApplications: configuration.applications,
    });
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByLabelText("Include Club APP");
  assert.equal(
    (screen.getByLabelText("Include Club APP") as HTMLInputElement).checked,
    false,
  );
  fireEvent.click(screen.getByLabelText("Include Club APP"));
  fireEvent.click(screen.getByText("Export configuration"));
  assert.deepEqual(
    JSON.parse(
      (screen.getByLabelText("Metadata-only export") as HTMLTextAreaElement)
        .value,
    ).applications,
    ["club-api", "app"],
  );
});
test("inherited tenant key roles and retained wrapping history have no editors", async () => {
  const keySets = [
    {
      reference: "profile/default",
      currentWrappingVersion: "v2",
      mappings: {
        wrapping: "WRAPPING_KEY",
        index: "INDEX_KEY",
        control: "CONTROL_KEY",
      },
      wrappingVersions: [
        { keyVersion: "v1", vaultVersion: "a".repeat(32) },
        { keyVersion: "v2", vaultVersion: "b".repeat(32) },
      ],
      indexVersion: "latest",
      controlVersion: "c".repeat(32),
    },
  ];
  globalThis.fetch = async () =>
    Response.json({
      revision: 0,
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
  assert.ok(screen.getByText("Wrapping · v1"));
  assert.ok(screen.getByText("Wrapping · v2"));
  assert.equal(screen.queryByLabelText("Current wrapping label"), null);
  assert.equal(screen.queryByText("Add existing key set"), null);
});
test("schema2 local roundtrip validates assignment references and rejects copied definitions", async () => {
  const { parseReferenceConfiguration } =
    await import("../src/lib/runtime-configuration");
  const refs = {
    kind: "runtime-configuration",
    schemaVersion: 2,
    id: "development",
    applications: ["club-api"],
    tenants: [{ tenant: "fcrww", applications: ["club-api"] }],
  };
  assert.deepEqual(
    JSON.parse(
      exportConfiguration(parseReferenceConfiguration(refs, "development")),
    ),
    refs,
  );
  assert.throws(() =>
    parseReferenceConfiguration({ ...refs, secrets: [] }, "development"),
  );
  assert.throws(() =>
    parseReferenceConfiguration(
      { ...refs, tenants: [{ tenant: "fcrww", applications: ["missing"] }] },
      "development",
    ),
  );
});

test("unchanged assignments can publish newly inherited canonical definitions", async () => {
  let sent: any;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "PUT") {
      sent = JSON.parse(String(init.body));
      return Response.json({
        revision: 2,
        publicationId: "canonical-publication",
        configuration,
      });
    }
    return Response.json({
      revision: 0,
      configuration,
      availableApplications: configuration.applications,
    });
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  await screen.findByText("MONGO_URI");
  assert.equal(
    (screen.getByText("Save configuration") as HTMLButtonElement).disabled,
    false,
  );
  fireEvent.click(screen.getByText("Save configuration"));
  await screen.findByText(/Saved configuration/);
  assert.equal(sent.configuration.schemaVersion, 2);
  assert.ok(screen.getByText(/Published metadata/));
});
test("published bindings show adoption only after a fresh scoped report", async () => {
  globalThis.fetch = async (input, init) =>
    String(input).includes("/status")
      ? Response.json({
          state: "applied",
          instances: [
            {
              instanceId: "fixture",
              lastSeen: Date.now(),
              expiresAt: Date.now() + 60000,
              status: "applied",
            },
          ],
        })
      : Response.json({
          revision: 1,
          publicationId: "published",
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
  await screen.findByText("Club API: Bindings adopted (consumer reported)");
  assert.ok(screen.getByText(/reports Vault binding adoption only/));
});

test("existing tenant loads from its own grant field without retyping its name", async () => {
  let loaded: any;
  globalThis.fetch = async (_url, options) => {
    const body = {path:String(_url),headers:options?.headers as Record<string,string>};
    if (body.path.endsWith("/tenants/fcrww")) {
      loaded = body;
      return Response.json({tenant:"fcrww", secrets:[], keySets:[], generation:2});
    }
    return Response.json({revision:0, configuration:{...configuration,tenants:[{tenant:"fcrww",applications:["club-api"],secrets:[],keySets:[]}]}});
  };
  render(<RuntimeConfigurationPanel connection={connection} />);
  fireEvent.click(await screen.findByRole("button",{name:"Expand fcrww"}));
  const grant = await screen.findByLabelText("Grant for fcrww") as HTMLInputElement;
  fireEvent.change(grant,{target:{value:"tenant-row-grant-aaaaaaaaaaaaaaaaaaaaaaaa"}});
  fireEvent.click(screen.getByRole("button",{name:"Load"}));
  await waitFor(()=>assert.ok(loaded));
  assert.equal(loaded.headers["x-vault-tenant"],"fcrww");
  assert.equal(loaded.headers["x-vault-token"],"tenant-row-grant-aaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(grant.value,"");
  assert.ok(screen.getByLabelText("Club API consumes fcrww"));
});
test("runtime credential rows show readable names with technical purpose underneath", async () => {
  const purpose="runtime-credential-aaaaaaaaaaaaaaaaaaaaaaaa";
  globalThis.fetch=async()=>Response.json({revision:0,configuration:{...configuration,tenants:[{tenant:"fcrww",applications:["club-api"],secrets:[{purpose,mapping:"RUNTIME_CREDENTIAL_AAAAAAAAAAAAAAAAAAAAAAAA",version:"latest",displayName:"Bexio OAuth credentials"}],keySets:[]}]}});
  render(<RuntimeConfigurationPanel connection={connection}/>);
  fireEvent.click(await screen.findByText("fcrww"));
  const title=await screen.findByText("Bexio OAuth credentials");
  assert.equal(title.closest("td")?.querySelector("small")?.textContent,purpose);
});
test("tenant expand control starts collapsed and toggles grant and details together", async () => {
  globalThis.fetch=async()=>Response.json({revision:0,configuration:{...configuration,tenants:[{tenant:"fcrww",applications:["club-api"],secrets:[],keySets:[]}]}});
  render(<RuntimeConfigurationPanel connection={connection}/>);
  const expand=await screen.findByRole("button",{name:"Expand fcrww"});
  assert.equal(expand.getAttribute("aria-expanded"),"false");
  assert.equal(screen.queryByLabelText("Grant for fcrww"),null);
  assert.equal(screen.queryByRole("region",{name:"Bindings for fcrww"}),null);
  fireEvent.click(expand);
  assert.ok(screen.getByLabelText("Grant for fcrww"));
  assert.ok(screen.getByRole("region",{name:"Bindings for fcrww"}));
  const collapse=screen.getByRole("button",{name:"Collapse fcrww"});
  assert.equal(collapse.getAttribute("aria-expanded"),"true");
  fireEvent.click(collapse);
  assert.equal(screen.queryByLabelText("Grant for fcrww"),null);
  assert.equal(screen.queryByRole("region",{name:"Bindings for fcrww"}),null);
});
