import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import {
  getSignalDefinitionById,
  toggleSignalDefinition,
} from "@/services/signal-definition-service";

export const PATCH = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const segments = req.nextUrl.pathname.split("/");
    const id = segments[segments.indexOf("signal-definitions") + 1];

    const existing = await getSignalDefinitionById(id);
    if (!existing) {
      return Response.json({ error: "Signal definition not found" }, { status: 404 });
    }

    const body = await req.json();
    const definition = await toggleSignalDefinition(id, body.enabled !== false);
    return Response.json({ definition });
  },
);
