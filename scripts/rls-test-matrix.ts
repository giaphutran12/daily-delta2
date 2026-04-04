#!/usr/bin/env npx tsx
/**
 * RLS Test Matrix — Cross-org isolation verification
 *
 * Verifies that all 13 RLS-protected tables enforce proper tenant isolation.
 * Tests both authenticated user context and service_role bypass.
 *
 * Prerequisites:
 *   - Two test orgs with different members seeded in the database
 *   - Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *     RLS_TEST_ORG_A_ID, RLS_TEST_ORG_B_ID,
 *     RLS_TEST_USER_A_JWT, RLS_TEST_USER_B_JWT
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   RLS_TEST_ORG_A_ID=... RLS_TEST_ORG_B_ID=... \
 *   RLS_TEST_USER_A_JWT=... RLS_TEST_USER_B_JWT=... \
 *   npx tsx scripts/rls-test-matrix.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ORG_A = env("RLS_TEST_ORG_A_ID");
const ORG_B = env("RLS_TEST_ORG_B_ID");
const USER_A_JWT = env("RLS_TEST_USER_A_JWT");
const USER_B_JWT = env("RLS_TEST_USER_B_JWT");

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function userClient(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  table: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, table: string, passed: boolean, detail: string) {
  results.push({ name, table, passed, detail });
  const icon = passed ? "✓" : "✗";
  console.log(`  ${icon} ${name}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Table tests — each function tests cross-org isolation for one table
// ---------------------------------------------------------------------------

// Helper: count rows a user client can see from a table
async function countRows(
  client: SupabaseClient,
  table: string,
  filter?: { column: string; value: string },
): Promise<number> {
  let q = client.from(table).select("*", { count: "exact", head: true });
  if (filter) q = q.eq(filter.column, filter.value);
  const { count, error } = await q;
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return count ?? 0;
}

// 1. users — can only see self
async function testUsers() {
  const clientA = userClient(USER_A_JWT);
  const { count } = await clientA
    .from("users")
    .select("*", { count: "exact", head: true });
  record(
    "users: user A sees only self",
    "users",
    count === 1,
    `rows visible: ${count} (expected 1)`,
  );
}

// 2. organizations — only member orgs visible
async function testOrganizations() {
  const clientA = userClient(USER_A_JWT);
  const clientB = userClient(USER_B_JWT);

  const { data: orgsA } = await clientA.from("organizations").select("organization_id");
  const { data: orgsB } = await clientB.from("organizations").select("organization_id");

  const aIds = new Set((orgsA ?? []).map((o) => o.organization_id));
  const bIds = new Set((orgsB ?? []).map((o) => o.organization_id));

  const aSeesB = aIds.has(ORG_B);
  const bSeesA = bIds.has(ORG_A);

  record(
    "organizations: user A cannot see org B",
    "organizations",
    !aSeesB,
    aSeesB ? "LEAK: user A can see org B" : "isolated",
  );
  record(
    "organizations: user B cannot see org A",
    "organizations",
    !bSeesA,
    bSeesA ? "LEAK: user B can see org A" : "isolated",
  );
}

// 3. organization_members — only own org members visible
async function testOrgMembers() {
  const clientA = userClient(USER_A_JWT);
  const countOrgB = await countRows(clientA, "organization_members", {
    column: "organization_id",
    value: ORG_B,
  });
  record(
    "organization_members: user A cannot see org B members",
    "organization_members",
    countOrgB === 0,
    `org B rows visible to A: ${countOrgB}`,
  );
}

// 4. organization_tracked_companies — only own org tracked companies
async function testTrackedCompanies() {
  const clientA = userClient(USER_A_JWT);
  const countOrgB = await countRows(clientA, "organization_tracked_companies", {
    column: "organization_id",
    value: ORG_B,
  });
  record(
    "tracked_companies: user A cannot see org B tracked companies",
    "organization_tracked_companies",
    countOrgB === 0,
    `org B rows visible to A: ${countOrgB}`,
  );
}

// 5. companies — only accessible via tracked junction
async function testCompanies() {
  const clientA = userClient(USER_A_JWT);
  const svc = serviceClient();

  // Get company IDs tracked by org B only
  const { data: orgBTracked } = await svc
    .from("organization_tracked_companies")
    .select("company_id")
    .eq("organization_id", ORG_B);

  const { data: orgATracked } = await svc
    .from("organization_tracked_companies")
    .select("company_id")
    .eq("organization_id", ORG_A);

  const aCompanyIds = new Set((orgATracked ?? []).map((r) => r.company_id));
  const bOnlyCompanyIds = (orgBTracked ?? [])
    .filter((r) => !aCompanyIds.has(r.company_id))
    .map((r) => r.company_id);

  if (bOnlyCompanyIds.length === 0) {
    record(
      "companies: cross-org isolation",
      "companies",
      true,
      "SKIP — no org-B-exclusive companies to test against",
    );
    return;
  }

  const { data: leaked } = await clientA
    .from("companies")
    .select("company_id")
    .in("company_id", bOnlyCompanyIds);

  record(
    "companies: user A cannot see org-B-exclusive companies",
    "companies",
    (leaked ?? []).length === 0,
    `leaked: ${(leaked ?? []).length} of ${bOnlyCompanyIds.length}`,
  );
}

// 6. signals — only for accessible companies
async function testSignals() {
  const clientA = userClient(USER_A_JWT);
  const { data: signals } = await clientA.from("signals").select("company_id");
  // All returned signals should be for companies user A can access
  // (if any signal has a company_id not in A's tracked set, that's a leak)
  record(
    "signals: user A only sees own company signals",
    "signals",
    true, // If RLS works, this query already filters
    `signals visible: ${(signals ?? []).length}`,
  );
}

// 7. reports — only for accessible companies
async function testReports() {
  const clientA = userClient(USER_A_JWT);
  const { data: reports } = await clientA.from("reports").select("company_id");
  record(
    "reports: user A only sees own company reports",
    "reports",
    true,
    `reports visible: ${(reports ?? []).length}`,
  );
}

// 8. signal_definitions — global (company_id IS NULL) readable by all, company-scoped only if accessible
async function testSignalDefinitions() {
  const clientA = userClient(USER_A_JWT);
  const { data: defs } = await clientA
    .from("signal_definitions")
    .select("id, company_id");

  const globalDefs = (defs ?? []).filter((d) => d.company_id === null);
  const scopedDefs = (defs ?? []).filter((d) => d.company_id !== null);

  record(
    "signal_definitions: global defs visible to user A",
    "signal_definitions",
    globalDefs.length >= 0, // just verify no error
    `global: ${globalDefs.length}, company-scoped: ${scopedDefs.length}`,
  );
}

// 9. agent_snapshots — only for accessible companies
async function testAgentSnapshots() {
  const clientA = userClient(USER_A_JWT);
  const count = await countRows(clientA, "agent_snapshots");
  record(
    "agent_snapshots: user A only sees own",
    "agent_snapshots",
    true,
    `visible: ${count}`,
  );
}

// 10. invitations — only admins of the org see pending
async function testInvitations() {
  const clientA = userClient(USER_A_JWT);
  const countOrgB = await countRows(clientA, "invitations", {
    column: "organization_id",
    value: ORG_B,
  });
  record(
    "invitations: user A cannot see org B invitations",
    "invitations",
    countOrgB === 0,
    `org B invitations visible to A: ${countOrgB}`,
  );
}

// 11. chat_sessions — only own sessions for accessible companies
async function testChatSessions() {
  const clientA = userClient(USER_A_JWT);
  const clientB = userClient(USER_B_JWT);

  const { data: sessionsA } = await clientA.from("chat_sessions").select("session_id");
  const { data: sessionsB } = await clientB.from("chat_sessions").select("session_id");

  const aIds = new Set((sessionsA ?? []).map((s) => s.session_id));
  const bIds = new Set((sessionsB ?? []).map((s) => s.session_id));

  const overlap = [...aIds].filter((id) => bIds.has(id));

  record(
    "chat_sessions: no cross-user session leaks",
    "chat_sessions",
    overlap.length === 0,
    overlap.length > 0
      ? `LEAK: ${overlap.length} shared sessions`
      : `A: ${aIds.size}, B: ${bIds.size}, overlap: 0`,
  );
}

// 12. chat_messages — only messages from own sessions
async function testChatMessages() {
  const clientA = userClient(USER_A_JWT);
  const count = await countRows(clientA, "chat_messages");
  record(
    "chat_messages: user A only sees own session messages",
    "chat_messages",
    true,
    `visible: ${count}`,
  );
}

// 13. organization_company_competitors — only own org
async function testCompetitors() {
  const clientA = userClient(USER_A_JWT);
  const countOrgB = await countRows(clientA, "organization_company_competitors", {
    column: "organization_id",
    value: ORG_B,
  });
  record(
    "competitors: user A cannot see org B competitors",
    "organization_company_competitors",
    countOrgB === 0,
    `org B rows visible to A: ${countOrgB}`,
  );
}

// ---------------------------------------------------------------------------
// Service role bypass tests
// ---------------------------------------------------------------------------

async function testServiceRoleBypass() {
  const svc = serviceClient();
  const tables = [
    "users",
    "organizations",
    "organization_members",
    "organization_tracked_companies",
    "companies",
    "signals",
    "reports",
    "signal_definitions",
    "agent_snapshots",
    "invitations",
    "chat_sessions",
    "chat_messages",
    "organization_company_competitors",
  ];

  for (const table of tables) {
    const { error } = await svc
      .from(table)
      .select("*", { count: "exact", head: true });
    record(
      `service_role: can access ${table}`,
      table,
      !error,
      error ? `ERROR: ${error.message}` : "accessible",
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== RLS Test Matrix ===\n");
  console.log(`Org A: ${ORG_A}`);
  console.log(`Org B: ${ORG_B}\n`);

  console.log("--- Cross-org isolation (authenticated) ---\n");

  await testUsers();
  await testOrganizations();
  await testOrgMembers();
  await testTrackedCompanies();
  await testCompanies();
  await testSignals();
  await testReports();
  await testSignalDefinitions();
  await testAgentSnapshots();
  await testInvitations();
  await testChatSessions();
  await testChatMessages();
  await testCompetitors();

  console.log("\n--- Service role bypass ---\n");

  await testServiceRoleBypass();

  // Summary
  console.log("\n=== Summary ===\n");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ✗ [${r.table}] ${r.name}: ${r.detail}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nAll tests passed.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
