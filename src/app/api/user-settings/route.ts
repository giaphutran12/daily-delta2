import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import {
  getUserSettings,
  setUserEmail,
  setEmailFrequency,
  type EmailFrequency,
} from "@/services/user-service";
import {
  SetEmailRequestSchema,
  SetEmailFrequencyRequestSchema,
} from "@/lib/utils/validation";

const VALID_FREQUENCIES: EmailFrequency[] = [
  "daily",
  "every_3_days",
  "weekly",
  "monthly",
];

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

    if (body.frequency) {
      const parsed = SetEmailFrequencyRequestSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          { error: `Valid frequency required: ${VALID_FREQUENCIES.join(", ")}` },
          { status: 400 },
        );
      }
      await setEmailFrequency(ctx.userId, parsed.data.frequency);
      return Response.json({ success: true, email_frequency: parsed.data.frequency });
    }

    if (body.email) {
      const parsed = SetEmailRequestSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: "Valid email is required" }, { status: 400 });
      }

      const freq =
        body.email_frequency && VALID_FREQUENCIES.includes(body.email_frequency)
          ? body.email_frequency
          : undefined;

      const user = await setUserEmail(ctx.userId, parsed.data.email, freq);
      return Response.json({ success: true, user });
    }

    return Response.json({ error: "Email or frequency is required" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
