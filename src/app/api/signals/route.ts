import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { isTracking } from "@/services/company-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!companyId) {
    return Response.json({ error: "company_id is required" }, { status: 400 });
  }

  const tracking = await isTracking(ctx.organizationId, companyId);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "200", 10),
    500,
  );
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);

  const supabase = createAdminClient();

  const { data, error, count } = await supabase
    .from("signals")
    .select("*", { count: "exact" })
    .eq("company_id", companyId)
    .order("detected_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    signals: data ?? [],
    total: count ?? 0,
  });
});
