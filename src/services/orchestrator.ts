import { Company, SignalDefinition, SignalFinding } from "@/lib/types";
import { resolveTemplate, buildGoalFromDefinition } from "@/lib/utils/template";
import { buildDiscoveryGoal } from "@/services/goals";
import { startTinyfishAgent, runTinyfishAgentSync, TinyfishCallbacks } from "@/services/tinyfish-client";

interface AgentDefinition {
  id: string;
  type: string;
  name: string;
  url: string;
  goal: string;
  definitionId: string;
}

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

export async function runDiscoveryAgent(
  websiteUrl: string,
): Promise<unknown> {
  const response = await runTinyfishAgentSync({
    url: websiteUrl,
    goal: buildDiscoveryGoal(websiteUrl),
  });

  if (response.status === "COMPLETED" && response.result) {
    const raw = response.result;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  if (response.error) {
    console.error("[Discovery] Agent failed:", response.error);
  }

  return null;
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
