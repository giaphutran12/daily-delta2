import { Company, SignalDefinition, SignalFinding } from "@/lib/types";
import { resolveTemplate, buildGoalFromDefinition } from "@/lib/utils/template";
import { buildDiscoveryGoal } from "@/services/goals";
import { startTinyfishAgent, TinyfishCallbacks } from "@/services/tinyfish-client";

interface AgentDefinition {
  id: string;
  type: string;
  name: string;
  url: string;
  goal: string;
  definitionId: string;
}

interface EventPayload {
  type: string;
  data: unknown;
}

type SendEvent = (event: EventPayload) => Promise<void>;

function buildAgentsFromDefinitions(
  company: Company,
  definitions: SignalDefinition[],
): AgentDefinition[] {
  return definitions
    .filter((def) => def.enabled)
    .map((def) => {
      const resolvedUrl = resolveTemplate(def.target_url, company);
      const goal = buildGoalFromDefinition(
        def.name,
        resolvedUrl,
        resolveTemplate(def.search_instructions, company),
        def.signal_type,
        company.company_name,
      );

      return {
        id: `${def.signal_type}-${def.id.slice(0, 8)}-${company.company_id}`,
        type: def.signal_type,
        name: def.name,
        url: resolvedUrl,
        goal,
        definitionId: def.id,
      };
    });
}

export async function runIntelligenceAgents(
  company: Company,
  definitions: SignalDefinition[],
  sendEvent: SendEvent,
): Promise<SignalFinding[]> {
  const agents = buildAgentsFromDefinitions(company, definitions);
  const allFindings: SignalFinding[] = [];

  const agentPromises = agents.map((agent) => {
    return new Promise<void>((resolve) => {
      const callbacks: TinyfishCallbacks = {
        onConnecting: () => {
          void sendEvent({
            type: "agent_connecting",
            data: {
              agentId: agent.id,
              agentType: agent.type,
              agentName: agent.name,
              status: "connecting",
            },
          });
        },

        onBrowsing: (message: string) => {
          void sendEvent({
            type: "agent_browsing",
            data: {
              agentId: agent.id,
              agentType: agent.type,
              agentName: agent.name,
              status: "browsing",
              message,
            },
          });
        },

        onStreamingUrl: (streamingUrl: string) => {
          void sendEvent({
            type: "agent_streaming_url",
            data: {
              agentId: agent.id,
              agentType: agent.type,
              agentName: agent.name,
              status: "browsing",
              streamingUrl,
            },
          });
        },

        onStatus: (message: string) => {
          void sendEvent({
            type: "agent_status",
            data: {
              agentId: agent.id,
              agentType: agent.type,
              agentName: agent.name,
              status: "analyzing",
              message,
            },
          });
        },

        onComplete: (resultJson: unknown) => {
          const result = resultJson as { signals?: SignalFinding[] };
          const findings = (result?.signals || []).map((f) => ({
            ...f,
            signal_definition_id: agent.definitionId,
          }));

          allFindings.push(...findings);

          void sendEvent({
            type: "agent_complete",
            data: {
              agentId: agent.id,
              agentType: agent.type,
              agentName: agent.name,
              status: "complete",
              findings: { signals: findings },
            },
          });

          resolve();
        },

        onError: (error: string) => {
          void sendEvent({
            type: "agent_error",
            data: {
              agentId: agent.id,
              agentType: agent.type,
              agentName: agent.name,
              status: "error",
              error,
            },
          });

          resolve();
        },
      };

      startTinyfishAgent({ url: agent.url, goal: agent.goal }, callbacks);
    });
  });

  const results = await Promise.allSettled(agentPromises);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[ORCHESTRATOR] Agent failed:", result.reason);
    }
  }
  return allFindings;
}

export async function runDiscoveryAgent(
  websiteUrl: string,
  sendEvent?: SendEvent,
): Promise<unknown> {
  return new Promise((resolve) => {
    const callbacks: TinyfishCallbacks = {
      onConnecting: () => {
        if (!sendEvent) return;

        void sendEvent({
          type: "agent_connecting",
          data: {
            agentId: "discovery",
            agentType: "discovery",
            agentName: "Company Discovery",
            status: "connecting",
          },
        });
      },
      onBrowsing: (message) => {
        if (!sendEvent) return;

        void sendEvent({
          type: "agent_browsing",
          data: {
            agentId: "discovery",
            agentType: "discovery",
            agentName: "Company Discovery",
            status: "browsing",
            message,
          },
        });
      },
      onStreamingUrl: (streamingUrl) => {
        if (!sendEvent) return;

        void sendEvent({
          type: "agent_streaming_url",
          data: {
            agentId: "discovery",
            agentType: "discovery",
            agentName: "Company Discovery",
            status: "browsing",
            streamingUrl,
          },
        });
      },
      onStatus: (message) => {
        if (!sendEvent) return;

        void sendEvent({
          type: "agent_status",
          data: {
            agentId: "discovery",
            agentType: "discovery",
            agentName: "Company Discovery",
            status: "analyzing",
            message,
          },
        });
      },
      onComplete: (result) => {
        if (sendEvent) {
          void sendEvent({
            type: "discovery_complete",
            data: result,
          });
        }

        resolve(result);
      },
      onError: (error) => {
        if (sendEvent) {
          void sendEvent({
            type: "agent_error",
            data: {
              agentId: "discovery",
              agentType: "discovery",
              agentName: "Company Discovery",
              status: "error",
              error,
            },
          });
        }

        resolve(null);
      },
    };

    startTinyfishAgent(
      { url: websiteUrl, goal: buildDiscoveryGoal(websiteUrl) },
      callbacks,
    );
  });
}

export async function runIntelligenceAgentsSilent(
  company: Company,
  definitions: SignalDefinition[],
): Promise<SignalFinding[]> {
  const agents = buildAgentsFromDefinitions(company, definitions);
  const allFindings: SignalFinding[] = [];

  const agentPromises = agents.map((agent) => {
    return new Promise<void>((resolve) => {
      const callbacks: TinyfishCallbacks = {
        onConnecting: () => {},
        onBrowsing: () => {},
        onStreamingUrl: () => {},
        onStatus: () => {},
        onComplete: (resultJson: unknown) => {
          const result = resultJson as { signals?: SignalFinding[] };
          const findings = (result?.signals || []).map((f) => ({
            ...f,
            signal_definition_id: agent.definitionId,
          }));

          allFindings.push(...findings);
          resolve();
        },
        onError: () => {
          resolve();
        },
      };

      startTinyfishAgent({ url: agent.url, goal: agent.goal }, callbacks);
    });
  });

  const results = await Promise.allSettled(agentPromises);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[ORCHESTRATOR] Agent failed:", result.reason);
    }
  }
  return allFindings;
}
