import { NextRequest } from "next/server";
import {
  ApiAuthError,
  authenticateRequest,
  verifyOrganizationMembership,
} from "@/lib/auth/api-auth";

export interface AuthContext {
  userId: string;
  userEmail: string;
}

export interface OrgAuthContext extends AuthContext {
  organizationId: string;
}

type AuthHandler<TContext> = (req: NextRequest, ctx: TContext) => Promise<Response>;

function authErrorResponse(error: unknown): Response {
  if (error instanceof ApiAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error("[AUTH] Unexpected auth error:", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export function withAuth(handler: AuthHandler<AuthContext>) {
  return async function withAuthHandler(req: NextRequest): Promise<Response> {
    try {
      const user = await authenticateRequest(req);
      return handler(req, user);
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}

export function withOrg(handler: AuthHandler<OrgAuthContext>) {
  return async function withOrgHandler(req: NextRequest): Promise<Response> {
    try {
      const user = await authenticateRequest(req);
      const organizationId = req.headers.get("x-organization-id")?.trim();

      if (!organizationId) {
        throw new ApiAuthError(400, "X-Organization-Id header is required");
      }

      await verifyOrganizationMembership(user.userId, organizationId);
      return handler(req, { ...user, organizationId });
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}
