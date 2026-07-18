import { cookies } from "next/headers";
import { GOOGLE_AUTH_COOKIE } from "@/lib/googleAuth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(GOOGLE_AUTH_COOKIE);
  return Response.json({ ok: true });
}
