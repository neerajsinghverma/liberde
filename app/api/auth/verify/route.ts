import { NextRequest, NextResponse } from "next/server";
import { consumeAuthToken, setEmailVerified } from "@/lib/auth";

/**
 * Email-verification link target. The user clicks the link in their inbox; we
 * consume the token, mark them verified, and redirect to the login page with a
 * success (or error) flag so they can sign in.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const userId = await consumeAuthToken(token, "verify");
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (userId) {
    await setEmailVerified(userId);
    url.searchParams.set("verified", "1");
  } else {
    url.searchParams.set("verify_error", "1");
  }
  return NextResponse.redirect(url);
}
