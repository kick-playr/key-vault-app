import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:4001',
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
  await import('@testing-library/react');
const { ApplicationsPanel } =
  await import('../src/components/applications-panel');
const { supportedRoute } = await import('../src/lib/vault-proxy');
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
const connection = {
  environment: 'development',
  tenant: '_shared',
  token: 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaa',
};
test('application proxy routes are exact and do not admit runtime or arbitrary local paths', () => {
  assert.equal(supportedRoute('GET', ['local', 'applications']), true);
  assert.equal(
    supportedRoute('PUT', ['local', 'applications', 'club-api']),
    true,
  );
  assert.equal(
    supportedRoute('PUT', [
      'local',
      'applications',
      'club-api',
      'resources',
      'secrets',
      'database',
    ]),
    true,
  );
  assert.equal(
    supportedRoute('DELETE', [
      'local',
      'applications',
      'club-api',
      'resources',
      'secrets',
      'database',
    ]),
    true,
  );
  assert.equal(
    supportedRoute('PUT', [
      'local',
      'applications',
      '..',
      'resources',
      'secrets',
      'database',
    ]),
    false,
  );
  assert.equal(
    supportedRoute('POST', ['local', 'applications', 'club-api', 'runtime']),
    false,
  );
});
test('creates and edits apps, links an existing secret, shows canonical sharing and unlinks without reading values', async () => {
  let revision = 0;
  const apps: any[] = [];
  const calls: { path: string; body: any; method: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body, method });
    if (path.includes('local/inventory'))
      return Response.json({
        value: [
          {
            kind: 'secret',
            name: 'database',
            version: 'a'.repeat(32),
            id: 'http://127.0.0.1:4000/namespaces/development/_shared/secrets/database',
            versionId:
              'http://127.0.0.1:4000/namespaces/development/_shared/secrets/database/' +
              'a'.repeat(32),
            tags: { purpose: 'database', envName: 'DATABASE_URL' },
            attributes: { enabled: true },
          },
        ],
      });
    if (method !== 'GET') {
      assert.equal(body.expectedRevision, revision);
      revision++;
      if (path.includes('/resources/')) {
        const app = apps[0];
        app.resources =
          method === 'DELETE'
            ? []
            : [
                {
                  kind: 'secrets',
                  name: 'database',
                  envName: 'DATABASE_URL',
                  policy: 'latest',
                  version: 'a'.repeat(32),
                  enabled: true,
                  missing: false,
                  tags: { purpose: 'database' },
                  applications: ['club-api', 'explorer-api'],
                },
              ];
      } else {
        const name = path.split('/').at(-1)!;
        const old = apps.find((a) => a.name === name);
        if (old) Object.assign(old, body);
        else
          apps.push({
            name,
            displayName: body.displayName,
            description: body.description,
            supported: true,
            resources: [],
            runtimeStatus: 'not-connected',
          });
      }
    }
    return Response.json({
      revision,
      generation: revision,
      ...connection,
      token: undefined,
      applications: apps,
    });
  };
  render(<ApplicationsPanel connection={connection} />);
  await screen.findByText('No applications in this namespace.');
  fireEvent.change(screen.getByLabelText('Application name'), {
    target: { value: 'club-api' },
  });
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Club API' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create application' }));
  await screen.findByRole('button', { name: 'Club API' });
  fireEvent.click(screen.getByRole('button', { name: 'Club API' }));
  await screen.findByLabelText('Existing resource');
  fireEvent.change(screen.getByLabelText('Existing resource'), {
    target: { value: 'secrets/database' },
  });
  assert.equal(
    (screen.getByLabelText('ENV variable name') as HTMLInputElement).value,
    'DATABASE_URL',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Link resource' }));
  await screen.findByText('Also used by: explorer-api');
  assert.ok(
    screen.getByText(
      'Saved model. Check consumer reports for runtime adoption.',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Unlink database' }));
  await waitFor(() => assert.ok(calls.some((c) => c.method === 'DELETE')));
  assert.equal(
    calls.some(
      (c) => /\/secrets\/database$/.test(c.path) && c.method === 'GET',
    ),
    false,
  );
});
test('a denied model read shows permission error without offering a blind overwrite', async () => {
  globalThis.fetch = async () =>
    Response.json({ error: { code: 'Forbidden' } }, { status: 403 });
  render(<ApplicationsPanel connection={connection} />);
  assert.match((await screen.findByRole('alert')).textContent!, /permission/i);
  assert.equal(
    screen.queryByRole('button', { name: 'Create application' }),
    null,
  );
});
test('Applications is reachable from the console without replacing existing sections', async () => {
  const { VaultConsole } = await import('../src/components/vault-console');
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith('local/session'))
      return Response.json({
        authenticated: true,
        environment: 'development',
        tenant: '_shared',
      });
    if (path.endsWith('local/applications'))
      return Response.json({
        revision: 0,
        generation: 0,
        environment: 'development',
        tenant: '_shared',
        applications: [],
      });
    return Response.json({ value: [] });
  };
  render(<VaultConsole />);
  fireEvent.change(screen.getByLabelText('Tenant / namespace'), {
    target: { value: '_shared' },
  });
  fireEvent.change(screen.getByLabelText('Vault bearer token'), {
    target: { value: connection.token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect to namespace' }));
  await screen.findByRole('button', { name: 'Disconnect' });
  fireEvent.click(screen.getByRole('button', { name: 'Applications' }));
  await screen.findByRole('button', { name: 'Create application' });
  for (const name of [
    'Keys',
    'Secrets',
    'Advanced',
    'Keys (Azure-style)',
    'Secrets (Azure-style)',
  ])
    assert.ok(screen.getByRole('button', { name }));
});
test('editing a dirty application cannot silently discard fields when switching apps', async () => {
  globalThis.fetch = async (input) =>
    String(input).includes('inventory')
      ? Response.json({ value: [] })
      : Response.json({
          revision: 1,
          generation: 1,
          environment: 'development',
          tenant: '_shared',
          applications: ['club-api', 'explorer-api'].map((name) => ({
            name,
            displayName: name,
            description: '',
            supported: true,
            resources: [],
            runtimeStatus: 'not-connected',
          })),
        });
  render(<ApplicationsPanel connection={connection} />);
  fireEvent.click(await screen.findByRole('button', { name: 'club-api' }));
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'unsaved' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'explorer-api' }));
  assert.ok(await screen.findByRole('alertdialog'));
  assert.equal(
    (screen.getByLabelText('Description') as HTMLInputElement).value,
    'unsaved',
  );
});
test('reload replaces stale selected app drafts before using the new revision', async () => {
  let label = 'Original',
    revision = 1;
  let saved: any;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('inventory'))
      return Response.json({ value: [] });
    if (init?.method === 'PUT') saved = JSON.parse(String(init.body));
    return Response.json({
      revision,
      generation: revision,
      environment: 'development',
      tenant: '_shared',
      applications: [
        {
          name: 'club-api',
          displayName: label,
          description: '',
          supported: true,
          resources: [],
          runtimeStatus: 'not-connected',
        },
      ],
    });
  };
  render(<ApplicationsPanel connection={connection} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Original' }));
  label = 'Other operator';
  revision = 2;
  fireEvent.click(screen.getByRole('button', { name: 'Reload applications' }));
  await screen.findByRole('button', { name: 'Other operator' });
  assert.equal(
    (screen.getByLabelText('Application display name') as HTMLInputElement)
      .value,
    'Other operator',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save application' }));
  await waitFor(() => assert.equal(saved?.displayName, 'Other operator'));
});
test('saving details retains an unrelated unsaved link draft and its discard guard', async () => {
  const dirty: boolean[] = [];
  globalThis.fetch = async (input) =>
    String(input).includes('inventory')
      ? Response.json({ value: [] })
      : Response.json({
          revision: 1,
          generation: 1,
          environment: 'development',
          tenant: '_shared',
          applications: [
            {
              name: 'club-api',
              displayName: 'Club',
              description: '',
              supported: true,
              resources: [],
              runtimeStatus: 'not-connected',
            },
          ],
        });
  render(
    <ApplicationsPanel
      connection={connection}
      onDirty={(v) => dirty.push(v)}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Club' }));
  fireEvent.change(screen.getByLabelText('ENV variable name'), {
    target: { value: 'UNSAVED' },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'save this' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save application' }));
  await screen.findByText(
    'Saved model. Check consumer reports for runtime adoption.',
  );
  assert.equal(dirty.at(-1), true);
});
test('proxy preserves deletion of a secret literally named applications', async () => {
  const { forwardVault } = await import('../src/lib/vault-proxy');
  const r = await forwardVault(
    new Request('http://localhost:4001/api/vault/secrets/applications', {
      method: 'DELETE',
      headers: {
        'x-vault-token': connection.token,
        'x-vault-environment': 'development',
        'x-vault-tenant': '_shared',
      },
    }),
    ['secrets', 'applications'],
    {
      userId: 'fixture',
      upstream: 'http://127.0.0.1:4000',
      fetch: async () =>
        Response.json({ id: 'fixture', attributes: { enabled: true } }),
    },
  );
  assert.equal(r.status, 200);
});
test('tenant link submits separate scoped catalog credentials and clears the input afterward', async () => {
  const tenantConnection = { ...connection, tenant: 'club' };
  let received: string | null = null;
  let links = 0;
  const response = () => ({
    revision: links,
    generation: links,
    environment: 'development',
    tenant: 'club',
    applications: links
      ? [
          {
            name: 'club-api',
            displayName: 'Club',
            description: '',
            supported: true,
            resources: [],
            runtimeStatus: 'not-connected',
          },
        ]
      : [],
  });
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('inventory'))
      return Response.json({
        value: [
          {
            kind: 'secret',
            name: 'local',
            version: 'a'.repeat(32),
            id: 'http://127.0.0.1:4000/namespaces/development/club/secrets/local',
            versionId:
              'http://127.0.0.1:4000/namespaces/development/club/secrets/local/' +
              'a'.repeat(32),
            attributes: { enabled: true },
          },
        ],
      });
    if (init?.method === 'PUT') {
      received = new Headers(init.headers).get('x-vault-catalog-token');
      links++;
    }
    return Response.json(response());
  };
  render(<ApplicationsPanel connection={tenantConnection} />);
  await screen.findByText('No applications in this namespace.');
  fireEvent.change(screen.getByLabelText('Existing application name'), {
    target: { value: 'club-api' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Model tenant links' }));
  fireEvent.change(screen.getByLabelText('Existing resource'), {
    target: { value: 'secrets/local' },
  });
  fireEvent.change(screen.getByLabelText('ENV variable name'), {
    target: { value: 'LOCAL_KEY' },
  });
  fireEvent.change(
    screen.getByLabelText('Application catalog token (_shared)'),
    { target: { value: 'separate-catalog-token-aaaaaaaaaaaaaaaa' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Link resource' }));
  await screen.findByText(
    'Saved model. Check consumer reports for runtime adoption.',
  );
  assert.equal(received, 'separate-catalog-token-aaaaaaaaaaaaaaaa');
  assert.equal(
    (
      screen.getByLabelText(
        'Application catalog token (_shared)',
      ) as HTMLInputElement
    ).value,
    '',
  );
});
test('proxy forwards catalog credentials only on an exact application link route', async () => {
  const { forwardVault } = await import('../src/lib/vault-proxy');
  let upstreamHeaders: Headers | undefined;
  const headers = {
    'x-vault-token': connection.token,
    'x-vault-catalog-token': 'separate-catalog-token-aaaaaaaaaaaaaaaa',
    'x-vault-environment': 'development',
    'x-vault-tenant': 'club',
    'content-type': 'application/json',
  };
  const options = {
    userId: 'fixture',
    upstream: 'http://127.0.0.1:4000',
    fetch: async (_input: unknown, init?: RequestInit) => {
      upstreamHeaders = new Headers(init?.headers);
      return Response.json({ revision: 1 });
    },
  };
  const link = [
    'local',
    'applications',
    'club-api',
    'resources',
    'secrets',
    'local',
  ];
  const good = await forwardVault(
    new Request('http://localhost:4001/api/vault/' + link.join('/'), {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        expectedRevision: 0,
        envName: 'LOCAL_KEY',
        version: 'latest',
      }),
    }),
    link,
    options,
  );
  assert.equal(good.status, 200);
  assert.equal(
    upstreamHeaders?.get('x-vault-catalog-token'),
    headers['x-vault-catalog-token'],
  );
  const bad = await forwardVault(
    new Request('http://localhost:4001/api/vault/local/applications', {
      headers,
    }),
    ['local', 'applications'],
    options,
  );
  assert.equal(bad.status, 400);
});
test('tenant application name navigation guards an unsaved resource mapping', async () => {
  globalThis.fetch = async (input) =>
    String(input).includes('inventory')
      ? Response.json({ value: [] })
      : Response.json({
          revision: 0,
          generation: 0,
          environment: 'development',
          tenant: 'club',
          applications: [],
        });
  render(<ApplicationsPanel connection={{ ...connection, tenant: 'club' }} />);
  await screen.findByText('No applications in this namespace.');
  fireEvent.change(screen.getByLabelText('Existing application name'), {
    target: { value: 'club-api' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Model tenant links' }));
  fireEvent.change(screen.getByLabelText('ENV variable name'), {
    target: { value: 'UNSAVED' },
  });
  fireEvent.change(screen.getByLabelText('Existing application name'), {
    target: { value: 'explorer-api' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Model tenant links' }));
  await screen.findByRole('alertdialog');
  assert.equal(
    (screen.getByLabelText('ENV variable name') as HTMLInputElement).value,
    'UNSAVED',
  );
});
test('shows reported runtime adoption without fetching values or accepting instance proof fields', async () => {
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith('/status'))
      return Response.json({
        state: 'applied',
        instances: [
          {
            instanceId: 'a'.repeat(36),
            lastSeen: Date.now(),
            expiresAt: Date.now() + 30000,
            generation: 2,
            digest: 'b'.repeat(64),
            status: 'applied',
            proof: 'DO_NOT_RENDER',
          },
        ],
      });
    return path.includes('inventory')
      ? Response.json({ value: [] })
      : Response.json({
          revision: 1,
          generation: 1,
          environment: 'development',
          tenant: '_shared',
          applications: [
            {
              name: 'app',
              displayName: 'App',
              description: '',
              supported: true,
              resources: [],
              runtimeStatus: 'not-connected',
            },
          ],
        });
  };
  render(<ApplicationsPanel connection={connection} />);
  fireEvent.click(await screen.findByRole('button', { name: 'App' }));
  await screen.findByText('Applied by 1 reporting instance.');
  assert.equal(screen.queryByText('DO_NOT_RENDER'), null);
  assert.equal(
    supportedRoute('GET', ['local', 'applications', 'app', 'status']),
    true,
  );
  assert.equal(
    supportedRoute('POST', ['local', 'application-runtime', 'app', 'snapshot']),
    false,
  );
});
test('live configuration requires explicit UI activation after modelling links',async()=>{
  let liveEnabled=false,activated=false;
  globalThis.fetch=async(input,init)=>{
    const path=String(input);if(path.endsWith('/status'))return Response.json({state:'not-connected',instances:[]});
    if(path.includes('inventory'))return Response.json({value:[]});
    if(path.endsWith('/activate')){activated=true;liveEnabled=true;assert.equal(init?.method,'PUT');}
    return Response.json({revision:liveEnabled?2:1,generation:1,environment:'development',tenant:'_shared',applications:[{name:'app',displayName:'App',description:'',supported:true,liveEnabled,resources:[{kind:'secrets',name:'database',envName:'DATABASE_URL',policy:'latest',version:'a'.repeat(32),enabled:true,missing:false,tags:{},applications:['app']}],runtimeStatus:'not-connected'}]});
  };
  render(<ApplicationsPanel connection={connection}/>);fireEvent.click(await screen.findByRole('button',{name:'App'}));
  assert.equal(activated,false);fireEvent.click(screen.getByText('Use live configuration').closest('summary')!);
  fireEvent.click(screen.getByRole('button',{name:'Activate live configuration'}));
  await screen.findByText('Live configuration enabled. Check consumer reports for adoption.');assert.equal(activated,true);
  assert.equal(supportedRoute('PUT',['local','applications','app','activate']),true);
});
