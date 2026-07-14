/**
 * Inngest is intentionally suspended for this application.
 *
 * Keep this as a code-level switch so a deployment cannot accidentally resume
 * production schedules because an old environment variable is still present.
 */
export const INNGEST_ENABLED = false;

export const INNGEST_DISABLED_MESSAGE =
  "Inngest workflows are disabled for Daily Delta";
