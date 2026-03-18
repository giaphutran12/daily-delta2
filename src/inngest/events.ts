import { eventType, staticSchema } from "inngest";

/**
 * daily-delta/daily.cron
 * Fired by the cron trigger at 7 AM Eastern daily.
 * Kicks off the fan-out pipeline: cron → per-org → per-company.
 */
export const dailyCron = eventType("daily-delta/daily.cron", {
  schema: staticSchema<Record<string, never>>(),
});

/**
 * daily-delta/org.process
 * Dispatched per organization during the daily pipeline.
 * Each org is processed with its own concurrency slot.
 */
export const orgProcess = eventType("daily-delta/org.process", {
  schema: staticSchema<{ organizationId: string }>(),
});

/**
 * daily-delta/company.process
 * Dispatched per company within an organization.
 * Runs intelligence agents and generates reports.
 */
export const companyProcess = eventType("daily-delta/company.process", {
  schema: staticSchema<{ companyId: string; organizationId: string }>(),
});
