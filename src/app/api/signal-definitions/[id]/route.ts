import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { SignalDefinitionUpdateSchema } from "@/lib/utils/validation";
import {
  getSignalDefinitionById,
  updateSignalDefinition,
  deleteSignalDefinition,
} from "@/services/signal-definition-service";

export const PUT = withOrg(
  async (
    req: NextRequest,
    ctx: OrgAuthContext,
  ) => {
    const segments = req.nextUrl.pathname.split("/");
    const id = segments[segments.indexOf("signal-definitions") + 1];

    const existing = await getSignalDefinitionById(id);
    if (!existing || existing.organization_id !== ctx.organizationId) {
      return Response.json({ error: "Signal definition not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = SignalDefinitionUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed" },
        { status: 400 },
      );
    }

    const definition = await updateSignalDefinition(id, parsed.data);
    return Response.json({ definition });
  },
);

export const DELETE = withOrg(
  async (
    req: NextRequest,
    ctx: OrgAuthContext,
  ) => {
    const segments = req.nextUrl.pathname.split("/");
    const id = segments[segments.indexOf("signal-definitions") + 1];

    const existing = await getSignalDefinitionById(id);
    if (!existing || existing.organization_id !== ctx.organizationId) {
      return Response.json({ error: "Signal definition not found" }, { status: 404 });
    }

    await deleteSignalDefinition(id);
    return Response.json({ success: true });
  },
);
