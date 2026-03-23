import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { isTracking } from "@/services/company-service";
import {
  getOrCreateSession,
  getSessionMessages,
} from "@/services/chat-service";

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const chatIdx = parts.indexOf("chat");
  const companyId = parts[chatIdx + 1];

  if (!companyId) {
    return Response.json({ error: "Company ID is required" }, { status: 400 });
  }

  const tracking = await isTracking(ctx.organizationId, companyId);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const session = await getOrCreateSession(companyId, ctx.userId);
  const dbMessages = await getSessionMessages(session.session_id);

  const messages = dbMessages.map((m) => ({
    id: m.message_id,
    role: m.role as "user" | "assistant",
    parts: m.parts ?? [{ type: "text" as const, text: m.content }],
  }));

  return Response.json({ messages, sessionId: session.session_id });
});
