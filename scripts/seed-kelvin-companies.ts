#!/usr/bin/env npx tsx
/**
 * Seed Kelvin's org with Simantak's startup list (29 companies).
 *
 * Looks up Kelvin by email, finds his org, then adds + tracks each company.
 * Idempotent — safe to re-run; existing companies are skipped.
 *
 * Prerequisites:
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Usage:
 *   node --env-file=.env.local --import tsx/esm scripts/seed-kelvin-companies.ts
 *
 *   Or install tsx globally and run:
 *   npx tsx --tsconfig tsconfig.json scripts/seed-kelvin-companies.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local if env vars not already set
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envFile = readFileSync(envPath, "utf8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not found — rely on env vars being set externally
}

import { addCompanyToPlatform, trackCompany } from "@/services/company-service";
import { getOrganizationsForUser } from "@/services/organization-service";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TARGET_EMAIL = "pentalaacenha@gmail.com";

const STARTUP_URLS: readonly string[] = [
  "https://schemata.com/",
  "https://www.tesseralabs.ai/",
  "https://www.file.ai/",
  "https://axisanalysis.com/",
  "https://linqalpha.com/",
  "https://www.menosai.com/",
  "https://jinba.io/",
  "https://datalinks.com/",
  "https://www.stackai.com/",
  "https://nex.ad/",
  "https://www.orbifold.ai/",
  "https://www.clipto.com/",
  "https://www.typeless.com/",
  "https://www.oximy.com/",
  "https://datature.io/",
  "https://memories.ai/",
  "https://www.zeroport.com/",
  "https://www.athenaintel.com/",
  "https://plato.so/",
  "https://www.jobotics.ai/",
  "https://mundoai.world/",
  "https://www.expertise.ai/",
  "https://www.swxtch.io/",
  "https://www.azoma.ai/",
  "https://www.industrialmind.ai/en/",
  "https://www.withdaydream.com/",
  "https://www.rlwrld.ai/",
  "https://www.rhoda.ai/",
  "https://pokee.ai/",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function findUserByEmail(email: string): Promise<string> {
  const supabase = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const {
    data: { users },
    error,
  } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  if (error) throw new Error(`Failed to list users: ${error.message}`);

  const user = users.find((u) => u.email === email);
  if (!user) throw new Error(`User not found: ${email}`);

  return user.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Looking up user: ${TARGET_EMAIL}`);
  const userId = await findUserByEmail(TARGET_EMAIL);
  console.log(`Found user: ${userId}`);

  const orgs = await getOrganizationsForUser(userId);
  if (orgs.length === 0) throw new Error("User has no organizations");

  const org = orgs[0];
  console.log(`Target org: ${org.name} (${org.organization_id})`);
  console.log(`\nSeeding ${STARTUP_URLS.length} companies...\n`);

  let added = 0;
  let existed = 0;
  let failed = 0;

  for (const url of STARTUP_URLS) {
    try {
      const { company, already_existed } = await addCompanyToPlatform(
        url,
        userId,
      );
      await trackCompany(org.organization_id, company.company_id, userId);

      if (already_existed) {
        existed++;
        console.log(`  ✓ ${company.company_name} (${company.domain}) — already existed, now tracked`);
      } else {
        added++;
        console.log(`  + ${company.company_name} (${company.domain}) — added + tracked`);
      }
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${url} — ${msg}`);
    }
  }

  console.log(`\nDone: ${added} added, ${existed} already existed, ${failed} failed`);
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
