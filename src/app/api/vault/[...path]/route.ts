import { auth } from "@clerk/nextjs/server";
import { forwardVault } from "../../../../lib/vault-proxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const headers = { "Cache-Control": "no-store" };
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    return Response.json(
      { error: { code: "SignInUnavailable" } },
      { status: 503, headers },
    );
  let userId: string | null;
  try {
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
