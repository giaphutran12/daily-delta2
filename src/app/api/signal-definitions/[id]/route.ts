import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { SignalDefinitionUpdateSchema } from "@/lib/utils/validation";
import { isTracking } from "@/services/company-service";
import {
  getSignalDefinitionById,
  updateSignalDefinition,
  deleteSignalDefinition,
} from "@/services/signal-definition-service";

function extractId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.indexOf("signal-definitions") + 1];
}

/**
 * PUT /api/signal-definitions/[id]
 * Update a custom signal definition. Rejects updates to platform defaults.
 */
export const PUT = withOrg(
  async (req: NextRequest, ctx: OrgAuthContext) => {
    const id = extractId(req);

    const existing = await getSignalDefinitionById(id);
    if (!existing) {
      return Response.json({ error: "Signal definition not found" }, { status: 404 });
    }

    if (existing.is_default) {
      return Response.json(
        { error: "Cannot modify platform default signals" },
        { status: 403 },
      );
    }

    if (existing.company_id) {
      const tracking = await isTracking(ctx.organizationId, existing.company_id);
      if (!tracking) {
        return Response.json({ error: "Signal definition not found" }, { status: 404 });
      }
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

/**
 * DELETE /api/signal-definitions/[id]
 * Delete a custom signal definition. Rejects deletion of platform defaults.
 */
export const DELETE = withOrg(
  async (req: NextRequest, ctx: OrgAuthContext) => {
    const id = extractId(req);

    const existing = await getSignalDefinitionById(id);
    if (!existing) {
      return Response.json({ error: "Signal definition not found" }, { status: 404 });
    }

    if (existing.is_default) {
      return Response.json(
        { error: "Cannot delete platform default signals" },
        { status: 403 },
      );
    }

    if (existing.company_id) {
      const tracking = await isTracking(ctx.organizationId, existing.company_id);
      if (!tracking) {
        return Response.json({ error: "Signal definition not found" }, { status: 404 });
      }
    }

    await deleteSignalDefinition(id);
    return Response.json({ success: true });
  },
);
