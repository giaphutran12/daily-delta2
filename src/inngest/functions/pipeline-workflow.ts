import { inngest } from "../client";
import {
  COMPANY_COMPLETED_EVENT,
  COMPANY_REQUESTED_EVENT,
  PIPELINE_FINALIZE_EVENT,
  PIPELINE_REQUESTED_EVENT,
  type CompanyCompletedEventData,
  type CompanyRequestedEventData,
  type PipelineFinalizeEventData,
  type PipelineRequestedEventData,
} from "@/inngest/events";
import {
  buildPipelineDeliveryPlan,
  claimPipelineRequestForFinalization,
  handleCompanyRunCompletion,
  markCompanyRunsRequested,
  markPipelineRequestFinalized,
  preparePipelineRequest,
  sendPipelineDigestDelivery,
} from "@/services/pipeline-request-service";
import {
  failCompanyRun,
  finalizeCompanyAgents,
  maybeReuseRecentReport,
  pollCompanyAgents,
  submitCompanyAgents,
} from "@/services/pipeline-service";

const AGENT_POLL_INTERVAL = "1 min";
const MAX_AGENT_POLLS = 480;

function sanitizeStepId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
}

export const pipelineRequested = inngest.createFunction(
  {
    id: "pipeline-requested",
    triggers: [{ event: PIPELINE_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as PipelineRequestedEventData;

    const prepared = await step.run("prepare-pipeline-request", () =>
      preparePipelineRequest(event.id, data.source, data.requestId, data.requestKey, data.companyIds, {
        organizationId: data.organizationId,
        requestedByUserId: data.requestedByUserId,
        recipientUserIds: data.recipientUserIds,
      }),
    );

    if (prepared.dispatches.length > 0) {
      await step.sendEvent(
        "dispatch-company-runs",
        prepared.dispatches.map((dispatch) => ({
          name: COMPANY_REQUESTED_EVENT,
          data: {
            companyRunId: dispatch.companyRunId,
            companyId: dispatch.companyId,
          },
        })),
      );

      await step.run("mark-company-runs-requested", () =>
        markCompanyRunsRequested(
          prepared.dispatches.map((dispatch) => dispatch.companyRunId),
        ),
      );
    }

    return {
      requestId: prepared.requestId,
      source: prepared.source,
      companiesQueued: prepared.companyIds.length,
      dispatchedCompanyRuns: prepared.dispatches.length,
    };
  },
);

export const processCompanyPipelineRun = inngest.createFunction(
  {
    id: "process-company-pipeline-run",
    triggers: [{ event: COMPANY_REQUESTED_EVENT }],
    singleton: {
      key: "event.data.companyId",
      mode: "skip",
    },
  },
  async ({ event, step }) => {
    const data = event.data as CompanyRequestedEventData;
    try {
      const reused = await step.run("maybe-reuse-recent-report", () =>
        maybeReuseRecentReport(data.companyRunId),
      );

      if (reused.result) {
        if (reused.cacheHit) {
          await step.sendEvent("notify-company-run-completed-from-cache", {
            name: COMPANY_COMPLETED_EVENT,
            data: {
              companyRunId: data.companyRunId,
            },
          });
        }

        return reused.result;
      }

      await step.run("submit-company-agents", () =>
        submitCompanyAgents(data.companyRunId),
      );

      let pollResult = await step.run("poll-company-agents-0", () =>
        pollCompanyAgents(data.companyRunId),
      );

      let pollAttempt = 0;
      while (!pollResult.terminal) {
        pollAttempt += 1;
        if (pollAttempt > MAX_AGENT_POLLS) {
          throw new Error(
            `Company run ${data.companyRunId} exceeded the maximum poll budget`,
          );
        }

        await step.sleep(`wait-for-company-agents-${pollAttempt}`, AGENT_POLL_INTERVAL);
        pollResult = await step.run(`poll-company-agents-${pollAttempt}`, () =>
          pollCompanyAgents(data.companyRunId),
        );
      }

      const result = await step.run("finalize-company-agents", () =>
        finalizeCompanyAgents(data.companyRunId),
      );

      await step.sendEvent("notify-company-run-completed", {
        name: COMPANY_COMPLETED_EVENT,
        data: {
          companyRunId: data.companyRunId,
        },
      });

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const failed = await step.run("mark-company-run-failed", () =>
        failCompanyRun(data.companyRunId, message),
      );

      await step.sendEvent("notify-company-run-completed-after-failure", {
        name: COMPANY_COMPLETED_EVENT,
        data: {
          companyRunId: data.companyRunId,
        },
      });

      return failed;
    }
  },
);

export const companyRunCompleted = inngest.createFunction(
  {
    id: "company-run-completed",
    triggers: [{ event: COMPANY_COMPLETED_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as CompanyCompletedEventData;
    const effects = await step.run("apply-company-run-effects", () =>
      handleCompanyRunCompletion(data.companyRunId),
    );

    if (effects.successorDispatch) {
      await step.sendEvent("dispatch-successor-company-run", {
        name: COMPANY_REQUESTED_EVENT,
        data: {
          companyRunId: effects.successorDispatch.companyRunId,
          companyId: effects.successorDispatch.companyId,
        },
      });

      await step.run("mark-successor-company-run-requested", () =>
        markCompanyRunsRequested([effects.successorDispatch!.companyRunId]),
      );
    }

    if (effects.finalizeRequestIds.length > 0) {
      await step.sendEvent(
        "queue-request-finalization",
        effects.finalizeRequestIds.map((requestId) => ({
          name: PIPELINE_FINALIZE_EVENT,
          data: {
            requestId,
          },
        })),
      );
    }

    return {
      companyRunId: data.companyRunId,
      finalizedRequests: effects.finalizeRequestIds.length,
      successorQueued: !!effects.successorDispatch,
    };
  },
);

export const finalizePipelineRequest = inngest.createFunction(
  {
    id: "finalize-pipeline-request",
    triggers: [{ event: PIPELINE_FINALIZE_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as PipelineFinalizeEventData;

    const claim = await step.run("claim-request-finalization", () =>
      claimPipelineRequestForFinalization(data.requestId),
    );

    if (!claim.claimed) {
      return {
        requestId: data.requestId,
        status: "already-finalized",
      };
    }

    const deliveryPlan = await step.run("build-delivery-plan", () =>
      buildPipelineDeliveryPlan(data.requestId),
    );

    const deliveryResults = await Promise.all(
      deliveryPlan.deliveries.map((delivery) =>
        step.run(
          `send-${sanitizeStepId(delivery.orgId)}-${sanitizeStepId(delivery.email)}`,
          () => sendPipelineDigestDelivery(delivery),
        ),
      ),
    );

    const hadEmailFailures = deliveryResults.some((result) => !result.sent);

    await step.run("mark-request-finalized", () =>
      markPipelineRequestFinalized(data.requestId, {
        hadCompanyFailures: deliveryPlan.hadCompanyFailures,
        hadEmailFailures,
      }),
    );

    return {
      requestId: data.requestId,
      source: deliveryPlan.source,
      deliveryCount: deliveryPlan.deliveries.length,
      hadCompanyFailures: deliveryPlan.hadCompanyFailures,
      hadEmailFailures,
    };
  },
);
