import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createAdminClient } from "@/lib/supabase/admin";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export class ApiAuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiAuthUser {
  userId: string;
  userEmail: string;
}

function getSupabaseUrl(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new ApiAuthError(500, "Supabase URL is not configured");
  }
  return supabaseUrl;
}

function getIssuer(): string {
  const supabaseUrl = getSupabaseUrl().replace(/\/$/, "");
  return `${supabaseUrl}/auth/v1`;
}

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${getIssuer()}/.well-known/jwks.json`));
  }
  return jwks;
}

function normalizePayload(payload: JWTPayload): ApiAuthUser {
  if (!payload.sub) {
    throw new ApiAuthError(401, "Invalid or expired token");
  }

  const userEmail = typeof payload.email === "string" ? payload.email : "";

  return {
    userId: payload.sub,
    userEmail,
  };
}

export function getBearerToken(request: Request): string {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiAuthError(401, "Missing or invalid authorization header");
  }

  return authHeader.slice(7).trim();
}

export async function verifyBearerToken(token: string): Promise<ApiAuthUser> {
  const issuer = getIssuer();
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  try {
    const verification = jwtSecret
      ? await jwtVerify(token, new TextEncoder().encode(jwtSecret), { issuer })
      : await jwtVerify(token, getJwks(), { issuer });

    return normalizePayload(verification.payload);
  } catch (error) {
    console.error("[AUTH] Bearer JWT verification failed:", (error as Error).message);
    throw new ApiAuthError(401, "Invalid or expired token");
  }
}

export async function authenticateRequest(request: Request): Promise<ApiAuthUser> {
  const token = getBearerToken(request);
  return verifyBearerToken(token);
}

export async function verifyOrganizationMembership(
  userId: string,
  organizationId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[AUTH] Organization membership check failed:", error.message);
    throw new ApiAuthError(500, "Unable to verify organization membership");
  }

  if (!data) {
    throw new ApiAuthError(403, "Not a member of this organization");
  }
}
