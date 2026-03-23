import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import { getUserSettings, setUserEmail } from "@/services/user-service";
import { SetEmailRequestSchema } from "@/lib/utils/validation";

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  try {
    const settings = await getUserSettings(ctx.userId);
    return Response.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    const body = await req.json();

    if (body.email) {
      const parsed = SetEmailRequestSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: "Valid email is required" }, { status: 400 });
      }

      const user = await setUserEmail(ctx.userId, parsed.data.email);
      return Response.json({ success: true, user });
    }

    return Response.json({ error: "Email is required" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
