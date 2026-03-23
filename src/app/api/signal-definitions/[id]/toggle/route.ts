import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { isTracking } from "@/services/company-service";
import {
  getSignalDefinitionById,
  toggleSignalDefinition,
} from "@/services/signal-definition-service";

export const PATCH = withOrg(
  async (req: NextRequest, ctx: OrgAuthContext) => {
    const segments = req.nextUrl.pathname.split("/");
    const id = segments[segments.indexOf("signal-definitions") + 1];

    const existing = await getSignalDefinitionById(id);
    if (!existing) {
      return Response.json({ error: "Signal definition not found" }, { status: 404 });
    }

    if (existing.company_id) {
      const tracking = await isTracking(ctx.organizationId, existing.company_id);
      if (!tracking) {
        return Response.json({ error: "Signal definition not found" }, { status: 404 });
      }
    }

    const body = await req.json();
    const definition = await toggleSignalDefinition(id, body.enabled !== false);
    return Response.json({ definition });
  },
);
