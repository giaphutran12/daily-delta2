import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import {
  deleteCompanyBucket,
  updateCompanyBucket,
} from "@/services/company-bucket-service";

function extractBucketId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.length - 1];
}

export const PATCH = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const bucketId = extractBucketId(req);
  const body = (await req.json()) as { name?: string };
  const name = body.name?.trim() ?? "";

  if (!name) {
    return Response.json({ error: "Bucket name is required" }, { status: 400 });
  }

  try {
    const bucket = await updateCompanyBucket(ctx.organizationId, bucketId, name);
    return Response.json({ bucket });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update bucket" },
      { status: 400 },
    );
  }
});

export const DELETE = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const bucketId = extractBucketId(req);

  try {
    await deleteCompanyBucket(ctx.organizationId, bucketId);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete bucket" },
      { status: 400 },
    );
  }
});
