export interface ApplicationResource {
  kind: 'keys' | 'secrets';
  name: string;
  envName: string;
  policy: string;
  version?: string;
  enabled: boolean;
  missing: boolean;
  tags: Record<string, string>;
  applications: string[];
}
export interface ApplicationModel {
  name: string;
  displayName: string;
  description: string;
  supported: boolean;
  liveEnabled: boolean;
  resources: ApplicationResource[];
  runtimeStatus: 'not-connected';
}
export interface ApplicationsModel {
  revision: number;
  generation: number;
  environment: string;
  tenant: string;
  applications: ApplicationModel[];
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('Invalid application response.');
  return v as Record<string, unknown>;
};
const str = (v: unknown, max = 512): string => {
  if (typeof v !== 'string' || v.length > max)
    throw Error('Invalid application response.');
  return v;
};
export function parseApplications(
  input: unknown,
  scope: { environment: string; tenant: string },
): ApplicationsModel {
  const body = record(input);
  if (
    body.environment !== scope.environment ||
    body.tenant !== scope.tenant ||
    !Number.isSafeInteger(body.revision) ||
    (body.revision as number) < 0 ||
    !Number.isSafeInteger(body.generation) ||
    !Array.isArray(body.applications) ||
    body.applications.length > 100
  )
    throw Error('Invalid application response.');
  const applications = body.applications.map((raw) => {
    const a = record(raw),
      name = str(a.name, 64);
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      !Array.isArray(a.resources) ||
      a.resources.length > 500 ||
      typeof a.supported !== 'boolean' ||
      a.runtimeStatus !== 'not-connected'
    )
      throw Error('Invalid application response.');
    const resources = a.resources.map((rawResource) => {
      const r = record(rawResource);
      if (
        !['keys', 'secrets'].includes(String(r.kind)) ||
        !Array.isArray(r.applications) ||
        r.applications.length > 100 ||
        typeof r.enabled !== 'boolean' ||
        typeof r.missing !== 'boolean'
      )
        throw Error('Invalid application response.');
      const tags = Object.fromEntries(
        Object.entries(record(r.tags)).map(([k, v]) => [str(k), str(v)]),
      );
      // Pick metadata fields explicitly; arbitrary response fields never reach UI state.
      return {
        kind: r.kind as 'keys' | 'secrets',
        name: str(r.name, 127),
        envName: str(r.envName, 128),
        policy: str(r.policy, 32),
        ...(r.version === undefined ? {} : { version: str(r.version, 32) }),
        enabled: r.enabled,
        missing: r.missing,
        tags,
        applications: r.applications.map((x) => str(x, 64)),
      };
    });
    return {
      name,
      displayName: str(a.displayName, 128),
      description: str(a.description),
      supported: a.supported,
      liveEnabled: a.liveEnabled === true,
      resources,
      runtimeStatus: 'not-connected' as const,
    };
  });
  return {
    revision: body.revision as number,
    generation: body.generation as number,
    ...scope,
    applications,
  };
}

export interface ReportedRuntimeStatus {
  state:
    | 'not-connected'
    | 'updating'
    | 'applied'
    | 'warning'
    | 'blocked'
    | 'offline';
  instances: {
    instanceId: string;
    lastSeen: number;
    expiresAt: number;
    status: string;
  }[];
}
export function parseRuntimeStatus(input: unknown): ReportedRuntimeStatus {
  const body = record(input);
  if (
    ![
      'not-connected',
      'updating',
      'applied',
      'warning',
      'blocked',
      'offline',
    ].includes(String(body.state)) ||
    !Array.isArray(body.instances) ||
    body.instances.length > 128
  )
    throw Error('Invalid runtime status.');
  return {
    state: body.state as ReportedRuntimeStatus['state'],
    instances: body.instances.map((raw) => {
      const r = record(raw);
      if (
        !Number.isSafeInteger(r.lastSeen) ||
        !Number.isSafeInteger(r.expiresAt) ||
        !['updating', 'applied', 'warning', 'blocked'].includes(
          String(r.status),
        )
      )
        throw Error('Invalid runtime status.');
      return {
        instanceId: str(r.instanceId, 64),
        lastSeen: r.lastSeen as number,
        expiresAt: r.expiresAt as number,
        status: String(r.status),
      };
    }),
  };
}
