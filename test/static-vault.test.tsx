import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticResourceTable } from "../src/components/static-vault-console";
test("shows purpose, secondary ID and link filters without secret values or expanded inputs", () => {
  const html = renderToStaticMarkup(
    <StaticResourceTable
      resources={[
        {
          _id: "id-1",
          name: "Bexio Accounting",
          kind: "integration",
          currentVersionId: "v1",
          currentVersionNumber: 1,
          revision: 1,
        },
      ]}
      links={[]}
      onSave={async () => {}}
    />,
  );
  assert.match(html, /Bexio Accounting/);
  assert.match(html, /id-1/);
  assert.match(html, /Search key/);
  assert.match(html, /Filter by ENV/);
  assert.match(html, /Linked/);
  assert.match(html, /Unlinked/);
  assert.doesNotMatch(html, /PRIVATE/);
});
test("workload-only details keep metadata visible and disable human value and mutation controls", async () => {
  const { ResourceDetails } =
    await import("../src/components/static-vault-console");
  const html = renderToStaticMarkup(
    <ResourceDetails
      resource={{
        _id: "control-db",
        name: "Control database",
        kind: "secret",
        currentVersionId: "v1",
        currentVersionNumber: 1,
        revision: 1,
        custody: "workload-only",
      }}
      canRead
      canRotate
      disabled={false}
      call={async () => {
        throw Error("must not call");
      }}
      action={async () => {}}
    />,
  );
  assert.match(html, /Workload-only/);
  assert.match(html, /control-db/);
  assert.match(html, /Version: v1/);
  assert.match(html, /<button disabled="">Reveal value<\/button>/);
  assert.match(html, /<button disabled="">Revoke resource access<\/button>/);
  assert.match(html, /<button disabled="">Delete unused resource<\/button>/);
});
