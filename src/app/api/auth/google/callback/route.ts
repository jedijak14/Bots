import { handleCallback } from "@/app/api/auth/google/route";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleCallback(req);
}
