import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { SignalDefinitionCreateSchema } from "@/lib/utils/validation";
import {
  getSignalDefinitions,
  createSignalDefinition,
} from "@/services/signal-definition-service";

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = req.nextUrl.searchParams.get("company_id") ?? undefined;
  const definitions = await getSignalDefinitions(ctx.organizationId, companyId);
  return Response.json({ definitions });
});

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const body = await req.json();
  const parsed = SignalDefinitionCreateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 400 },
    );
  }

  const { scope, company_id, ...rest } = parsed.data;
  const definition = await createSignalDefinition(ctx.organizationId, {
    ...rest,
    scope,
    company_id: company_id ?? null,
  });

  return Response.json({ definition }, { status: 201 });
});
