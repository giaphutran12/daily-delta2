import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import {
  getPipelineRequestSnapshot,
  previewPipelineRequestDigest,
} from "@/services/pipeline-request-service";

function extractRequestId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.indexOf("pipeline-requests") + 1];
}

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const requestId = extractRequestId(req);
    const snapshot = await getPipelineRequestSnapshot(
      requestId,
      ctx.organizationId,
    );

    if (!snapshot) {
      return Response.json(
        { error: "Pipeline request not found" },
        { status: 404 },
      );
    }

    const preview = req.nextUrl.searchParams.get("preview");
    if (preview === "true") {
      if (!snapshot.allCompaniesTerminal) {
        return Response.json(
          { error: "Pipeline request is not ready for preview" },
          { status: 409 },
        );
      }

      const digestPreview = await previewPipelineRequestDigest(
        requestId,
        ctx.organizationId,
      );
      if (!digestPreview) {
        return Response.json(
          { error: "Pipeline request preview not found" },
          { status: 404 },
        );
      }

      return new Response(digestPreview.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Digest-Subject": encodeURIComponent(digestPreview.subject),
        },
      });
    }

    return Response.json(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
});
