import {signInConfigured} from "../../../../lib/server-secrets";
import { forwardVault } from "../../../../lib/vault-proxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const headers = { "Cache-Control": "no-store" };
  let userId: string | null;
  try {
    if (!(await signInConfigured())) throw Error();
    const {auth}=await import("@clerk/nextjs/server");
    userId = (await auth()).userId;
  } catch {
    return Response.json(
      { error: { code: "SignInUnavailable" } },
      { status: 503, headers },
    );
  }
  return forwardVault(request, (await context.params).path, {
    userId,
    upstream: process.env.VAULT_API_ORIGIN ?? "http://127.0.0.1:4000",
  });
}
export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
