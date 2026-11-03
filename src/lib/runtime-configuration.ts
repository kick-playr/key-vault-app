export interface SecretSelection {
  purpose: string;
  mapping: string;
  version?: string;
}
export interface KeyPlan {
  reference: string;
  currentWrappingVersion: string;
  wrappingVersions: { keyVersion: string; vaultVersion?: string }[];
  mappings?: { wrapping: string; index: string; control: string };
  indexVersion?: string;
  controlVersion?: string;
}
export interface TenantSelection {
  tenant: string;
  applications: string[];
  secrets: SecretSelection[];
  keySets: KeyPlan[];
}
export interface RuntimeConfigurationDocument {
  kind: "runtime-configuration";
  schemaVersion: 1;
  id: string;
  applications: Record<
    string,
    { displayName: string; description: string; secrets: SecretSelection[] }
  >;
  tenants: TenantSelection[];
}
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw Error("Invalid metadata-only configuration.");
  return v as Record<string, unknown>;
}
function string(v: unknown, max = 512): string {
  if (typeof v !== "string" || v.length > max)
    throw Error("Invalid metadata field.");
  return v;
}
function list(v: unknown): unknown[] {
  if (!Array.isArray(v) || v.length > 100)
    throw Error("Invalid metadata list.");
  return v;
}
function version(v: unknown): string {
  const s = string(v, 32);
  if (s !== "latest" && !/^[a-f0-9]{32}$/.test(s))
    throw Error("Select Latest or an immutable 32-character version.");
  return s;
}
function keyLabel(v: unknown): string {
  const s = string(v, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) || s === "latest")
    throw Error("Invalid wrapping label.");
  return s;
}
function mapping(v: unknown): string {
  const s = string(v, 128);
  if (!/^[A-Z][A-Z0-9_]*$/.test(s)) throw Error("Invalid ENV mapping.");
  return s;
}
function secrets(v: unknown, allowUnresolved = false): SecretSelection[] {
  return list(v).map((raw) => {
    const s = object(raw, ["purpose", "mapping", "version"]);
    return {
      purpose: string(s.purpose, 128),
      mapping: mapping(s.mapping),
      ...(s.version === undefined && allowUnresolved
        ? {}
        : { version: version(s.version) }),
    };
  });
}
export function parseKeySets(v: unknown): KeyPlan[] {
  return list(v).map((raw) => {
    const k = object(raw, [
      "reference",
      "currentWrappingVersion",
      "wrappingVersions",
      "mappings",
      "indexVersion",
      "controlVersion",
    ]);
    const m =
      k.mappings === undefined
        ? undefined
        : object(k.mappings, ["wrapping", "index", "control"]);
    return {
      reference: string(k.reference),
      currentWrappingVersion: keyLabel(k.currentWrappingVersion),
      wrappingVersions: list(k.wrappingVersions).map((raw) => {
        const w = object(raw, ["keyVersion", "vaultVersion"]);
        return {
          keyVersion: keyLabel(w.keyVersion),
          ...(w.vaultVersion === undefined
            ? {}
            : { vaultVersion: version(w.vaultVersion) }),
        };
      }),
      ...(m
        ? {
            mappings: {
              wrapping: mapping(m.wrapping),
              index: mapping(m.index),
              control: mapping(m.control),
            },
          }
        : {}),
      ...(k.indexVersion === undefined
        ? {}
        : { indexVersion: version(k.indexVersion) }),
      ...(k.controlVersion === undefined
        ? {}
        : { controlVersion: version(k.controlVersion) }),
    };
  });
}
export function parseTenant(
  input: unknown,
  allowUnresolved = false,
): TenantSelection {
  const t = object(input, ["tenant", "applications", "secrets", "keySets"]);
  const tenant = string(t.tenant, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant) || tenant === "_shared")
    throw Error("Invalid tenant slug.");
  return {
    tenant,
    applications: list(t.applications).map((a) => string(a, 64)),
    secrets: secrets(t.secrets, allowUnresolved),
    keySets: parseKeySets(t.keySets),
  };
}
export function parseConfiguration(
  input: unknown,
  environment: string,
  allowUnresolved = false,
): RuntimeConfigurationDocument {
  const c = object(input, [
    "kind",
    "schemaVersion",
    "id",
    "applications",
    "tenants",
  ]);
  if (
    c.kind !== "runtime-configuration" ||
    c.schemaVersion !== 1 ||
    c.id !== environment
  )
    throw Error("Configuration must match the connected environment.");
  if (
    !c.applications ||
    typeof c.applications !== "object" ||
    Array.isArray(c.applications)
  )
    throw Error("Invalid applications.");
  const applications = Object.fromEntries(
    Object.entries(c.applications).map(([slug, raw]) => {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(slug))
        throw Error("Invalid application slug.");
      const a = object(raw, ["displayName", "description", "secrets"]);
      return [
        slug,
        {
          displayName: string(a.displayName, 128),
          description: string(a.description),
          secrets: secrets(a.secrets, allowUnresolved),
        },
      ];
    }),
  );
  const tenants = list(c.tenants).map((t) => parseTenant(t, allowUnresolved));
  if (
    new Set(tenants.map((t) => t.tenant)).size !== tenants.length ||
    tenants.some((t) =>
      t.applications.some((a) => !Object.hasOwn(applications, a)),
    )
  )
    throw Error("Invalid tenant assignments.");
  return {
    kind: "runtime-configuration",
    schemaVersion: 1,
    id: environment,
    applications,
    tenants,
  };
}
export function exportConfiguration(
  configuration: RuntimeConfigurationDocument,
) {
  if (
    configuration.tenants.some((t) =>
      t.keySets.some(
        (k) =>
          k.indexVersion === undefined ||
          k.controlVersion === undefined ||
          k.wrappingVersions.some((w) => w.vaultVersion === undefined),
      ),
    )
  )
    throw Error("Resolve key-role versions with Save before exporting.");
  return JSON.stringify(
    parseConfiguration(configuration, configuration.id),
    null,
    2,
  );
}
