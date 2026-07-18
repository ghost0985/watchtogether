import { cookies } from "next/headers";
import { GOOGLE_AUTH_COOKIE } from "@/lib/googleAuth";

export async function GET() {
  const cookieStore = await cookies();
  const signedIn = !!cookieStore.get(GOOGLE_AUTH_COOKIE)?.value;
  return Response.json({ signedIn });
}
