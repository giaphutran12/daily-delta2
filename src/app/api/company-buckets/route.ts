import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import {
  createCompanyBucket,
  getCompanyBuckets,
} from "@/services/company-bucket-service";

export const GET = withOrg(async (_req: NextRequest, ctx: OrgAuthContext) => {
  const buckets = await getCompanyBuckets(ctx.organizationId);
  return Response.json({ buckets });
});

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const body = (await req.json()) as { name?: string };
  const name = body.name?.trim() ?? "";

  if (!name) {
    return Response.json({ error: "Bucket name is required" }, { status: 400 });
  }

  try {
    const bucket = await createCompanyBucket(ctx.organizationId, name);
    return Response.json({ bucket }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create bucket" },
      { status: 400 },
    );
  }
});
