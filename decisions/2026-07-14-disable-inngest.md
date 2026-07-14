Date: 2026-07-14
Status: active
Question: How should Daily Delta stop polluting the shared production Inngest dashboard?
Decision: Disable Inngest with a code-level constant, advertise only an inert event-triggered tombstone from the deployed Inngest endpoint, reject manual pipeline triggers, and suppress competitor refresh enqueueing.
Why: A code-level switch cannot be accidentally reversed by stale production environment variables. Inngest rejects an app sync with zero functions, so syncing the tombstone deregisters the previously deployed cron and event workers without adding a schedule.
Applies to: Daily Delta scheduled pipelines, manual pipeline triggers, and competitor refresh jobs.
Tradeoff: Daily Delta background processing remains unavailable until the constant is deliberately re-enabled and deployed.
Risk / Blast Radius: The production deployment must sync `/api/inngest` once after release; until then, the old registered cron can continue running.
Revisit when: Daily Delta has a dedicated Inngest environment or background processing is intentionally restored.
Related Edward Rules: Keep operational changes explicit, testable, documented, and reversible.
Related Project Notes: README.md Inngest status section; CHANGELOG.md 0.0.1.3 entry.
Source: Edward requested the Daily Delta Inngest integration be disabled on 2026-07-14 because its runs polluted his dashboard.
