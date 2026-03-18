import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import {
  getSignalDefinitionById,
  toggleSignalDefinition,
} from "@/services/signal-definition-service";

export const PATCH = withOrg(
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
    const definition = await toggleSignalDefinition(id, body.enabled !== false);
    return Response.json({ definition });
  },
);
