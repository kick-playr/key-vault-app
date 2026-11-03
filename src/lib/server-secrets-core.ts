export type SecretEnvironment = Readonly<Record<string, string | undefined>>;
type Live = {
  start(): Promise<void>;
  refresh(): Promise<void>;
  status(): { state: string };
  withValue<T>(fn: (value: Record<string, string>) => T): Promise<T>;
  close(): void;
};
const unavailable = () => Error("Vault console authentication unavailable");
const MAX_VERIFIED_AGE_MS = 5000;
export function createConsoleSecretsSource(
  input: Record<string, string | undefined>,
  factory?: () => Live | Promise<Live>,
  options: { now?: () => number } = {},
) {
  const environment = { ...input }, now = options.now ?? (() => performance.now());
  let pending: Promise<Live> | undefined, live: Live | undefined;
  let refreshing: Promise<void> | undefined, verifiedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false;
  const validate = (values: Record<string, string>) => {
    if (!/^sk_(test|live)_[A-Za-z0-9_-]+$/.test(values.CLERK_SECRET_KEY ?? "")) throw unavailable();
    const key = values.CLERK_ENCRYPTION_KEY ?? "";
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32) throw unavailable();
    return { CLERK_SECRET_KEY: values.CLERK_SECRET_KEY!, CLERK_ENCRYPTION_KEY: key };
  };
  async function construct(): Promise<Live> {
    if (factory) return factory();
    const { createApplicationRuntime } = await import("@kick-playr/local-key-vault/runtime-client");
    return createApplicationRuntime({
      application: "vault-app",
      scope: { environment: environment.LOCAL_KEYVAULT_ENVIRONMENT ?? "development", tenant: "_shared" },
      environment,
      allowedMappings: ["CLERK_SECRET_KEY", "CLERK_ENCRYPTION_KEY"],
      requiredMappings: ["CLERK_SECRET_KEY", "CLERK_ENCRYPTION_KEY"],
      intervalMs: 5000,
      prepare: snapshot => ({ value: validate(Object.fromEntries(snapshot.resources.map(r => [r.mapping, r.value]))) }),
    });
  }
  function schedule() {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = undefined; void refresh().catch(() => {}); }, 1000);
    timer.unref?.();
  }
  async function initialize() {
    if (closed) throw unavailable();
    return pending ??= construct().then(async runtime => {
      live = runtime;
      if (closed) { runtime.close(); throw unavailable(); }
      await runtime.start();
      if (runtime.status().state !== "applied") throw unavailable();
      verifiedAt = now();
      schedule();
      return runtime;
    }).catch(() => {
      live?.close(); live = undefined; pending = undefined; verifiedAt = undefined;
      throw unavailable();
    });
  }
  async function refresh() {
    try {
      const runtime = await initialize();
      if (timer) { clearTimeout(timer); timer = undefined; }
      return await (refreshing ??= (async () => {
        await runtime.refresh();
        if (runtime.status().state !== "applied") throw unavailable();
        verifiedAt = now();
      })().catch(() => { verifiedAt = undefined; throw unavailable(); }).finally(() => {
        refreshing = undefined; schedule();
      }));
    } catch { throw unavailable(); }
  }
  return {
    async load(): Promise<SecretEnvironment> {
      try {
        if (closed) throw unavailable();
        const strategy = environment.SECRETS_KEYS_STRATEGY ?? "ENV_VARIABLES";
        if (strategy === "ENV_VARIABLES") return Object.freeze({ ...environment });
        if (strategy !== "LOCAL_KEYVAULT" || !["development", "test"].includes(environment.NODE_ENV ?? "") ||
          environment.VERCEL !== undefined || environment.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
          ["production", "PROD"].includes(environment.STAGE ?? "")) throw unavailable();
        const runtime = await initialize();
        // Network I/O belongs to the background monitor, not every Clerk request.
        // Revocation/warnings block immediately; an unverified snapshot expires.
        if (runtime.status().state !== "applied" || verifiedAt === undefined || now() - verifiedAt > MAX_VERIFIED_AGE_MS) throw unavailable();
        return await runtime.withValue(values => Object.freeze({ ...environment, ...validate(values) }));
      } catch { throw unavailable(); }
    },
    refresh,
    close() { closed = true; if (timer) clearTimeout(timer); live?.close(); },
  };
}
