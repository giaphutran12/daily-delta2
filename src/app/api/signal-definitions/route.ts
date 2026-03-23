import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import { SignalDefinitionCreateSchema } from "@/lib/utils/validation";
import {
  getSignalDefinitions,
  createCustomSignal,
} from "@/services/signal-definition-service";

/**
 * GET /api/signal-definitions?company_id=X
 * Returns platform-level signal definitions (defaults + custom for company).
 */
export const GET = withAuth(async (req: NextRequest, _ctx: AuthContext) => {
  const companyId = req.nextUrl.searchParams.get("company_id") ?? undefined;
  const definitions = await getSignalDefinitions(companyId);
  return Response.json({ definitions });
});

/**
 * POST /api/signal-definitions
 * Create a custom signal for a specific company (platform-level).
 */
export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json();
  const parsed = SignalDefinitionCreateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 400 },
    );
  }

  const definition = await createCustomSignal({
    ...parsed.data,
    created_by: ctx.userId,
  });

  return Response.json({ definition }, { status: 201 });
});
