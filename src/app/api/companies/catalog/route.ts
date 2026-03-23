import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import { CatalogSearchSchema } from "@/lib/utils/validation";
import { searchCompanyCatalog } from "@/services/company-service";

/**
 * GET /api/companies/catalog?q=stripe&industry=fintech&limit=50&offset=0
 * Search the platform company database. Any authenticated user can search.
 */
export const GET = withAuth(async (req: NextRequest, _ctx: AuthContext) => {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = CatalogSearchSchema.safeParse(params);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 },
    );
  }

  const { q, industry, limit, offset } = parsed.data;

  const result = await searchCompanyCatalog(q, { industry }, limit, offset);

  return Response.json(result);
});
