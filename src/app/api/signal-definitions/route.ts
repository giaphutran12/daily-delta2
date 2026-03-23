import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { SignalDefinitionCreateSchema } from "@/lib/utils/validation";
import { isTracking } from "@/services/company-service";
import {
  getSignalDefinitions,
  createCustomSignal,
} from "@/services/signal-definition-service";

/**
 * GET /api/signal-definitions?company_id=X
 * Returns platform-level signal definitions (defaults + custom for company).
 */
export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = req.nextUrl.searchParams.get("company_id") ?? undefined;

  if (companyId) {
    const tracking = await isTracking(ctx.organizationId, companyId);
    if (!tracking) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }
  }

  const definitions = await getSignalDefinitions(companyId);
  return Response.json({ definitions });
});

/**
 * POST /api/signal-definitions
 * Create a custom signal for a specific company.
 */
export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const body = await req.json();
  const parsed = SignalDefinitionCreateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 400 },
    );
  }

  const tracking = await isTracking(ctx.organizationId, parsed.data.company_id);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const definition = await createCustomSignal({
    ...parsed.data,
    created_by: ctx.userId,
  });

  return Response.json({ definition }, { status: 201 });
});
