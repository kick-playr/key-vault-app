import { serverSecrets } from "./lib/server-secrets";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  try {
    const environment = await serverSecrets();
    if (!environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !environment.CLERK_SECRET_KEY) return NextResponse.next();
    const {clerkMiddleware} = await import("@clerk/nextjs/server");
    const middleware = environment.SECRETS_KEYS_STRATEGY === "LOCAL_KEYVAULT"
      ? clerkMiddleware(() => NextResponse.next(), () => ({
          publishableKey: environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          secretKey: environment.CLERK_SECRET_KEY,
        }))
      : clerkMiddleware();
    return await middleware(request,event);
  } catch {
    return new NextResponse("Sign-in temporarily unavailable",{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
export const config = { matcher: ["/", "/sign-in(.*)", "/api/vault(.*)"] };
