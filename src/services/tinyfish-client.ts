import { TinyFish } from "@tiny-fish/sdk";

const AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Public types (kept identical so callers need no changes)
// ---------------------------------------------------------------------------

export interface TinyfishCallbacks {
  onConnecting: () => void;
  onBrowsing: (message: string) => void;
  onStreamingUrl: (url: string) => void;
  onStatus: (message: string) => void;
  onComplete: (resultJson: unknown) => void;
  onError: (error: string) => void;
}

export interface TinyfishRequest {
  url: string;
  goal: string;
}

export interface TinyfishSyncResponse {
  run_id: string;
  status: "COMPLETED" | "FAILED";
  result: unknown;
  error: { code: string; message: string; category: string } | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getClient(): TinyFish {
  return new TinyFish(); // reads TINYFISH_API_KEY from env
}

/** Parse JSON if the value is a string, otherwise return as-is. */
function tryParseJson(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

type StreamEvent = Record<string, unknown>;

// ---------------------------------------------------------------------------
// startTinyfishAgent — streaming with callbacks (used by orchestrator)
// ---------------------------------------------------------------------------

export function startTinyfishAgent(
  config: TinyfishRequest,
  callbacks: TinyfishCallbacks,
): AbortController {
  const controller = new AbortController();

  callbacks.onConnecting();

  let completedNormally = false;

  const timeout = setTimeout(() => {
    if (!completedNormally) {
      controller.abort();
      callbacks.onComplete({ signals: [] });
    }
  }, AGENT_TIMEOUT_MS);

  (async () => {
    try {
      const client = getClient();
      const stream = await client.agent.stream({
        url: config.url,
        goal: config.goal,
      });

      let streamingUrlSent = false;

      for await (const rawEvent of stream) {
        if (controller.signal.aborted) break;

        const event = rawEvent as unknown as StreamEvent;

        if (
          event.type === "STREAMING_URL" &&
          event.streaming_url &&
          !streamingUrlSent
        ) {
          streamingUrlSent = true;
          callbacks.onStreamingUrl(event.streaming_url as string);
          callbacks.onBrowsing("Agent is browsing the website...");
        }

        if (event.type === "PROGRESS" && event.purpose) {
          callbacks.onStatus(event.purpose as string);
        }

        if (
          event.type === "STEP" ||
          (!event.type && (event.purpose || event.action))
        ) {
          const msg =
            (event.message as string) ||
            (event.purpose as string) ||
            (event.action as string) ||
            "Processing...";
          callbacks.onStatus(msg);
        }

        if (event.type === "COMPLETE" || event.status === "COMPLETED") {
          completedNormally = true;
          const raw = event.result ?? event.resultJson ?? null;
          const result = tryParseJson(raw);
          callbacks.onComplete(result);
          break;
        }

        if (event.type === "ERROR") {
          completedNormally = true;
          callbacks.onError(
            (event.message as string) ||
              (event.error as string) ||
              "Agent encountered an error",
          );
          break;
        }
      }
    } catch (err) {
      const error = err as Error;
      if (error.name !== "AbortError") {
        callbacks.onError(error.message);
      }
    } finally {
      clearTimeout(timeout);
    }
  })();

  return controller;
}

// ---------------------------------------------------------------------------
// runTinyfishAgentSync — awaits completion (used by discovery agent)
// ---------------------------------------------------------------------------

export async function runTinyfishAgentSync(
  config: TinyfishRequest,
): Promise<TinyfishSyncResponse> {
  const client = getClient();

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);

  try {
    const stream = await client.agent.stream({
      url: config.url,
      goal: config.goal,
    });

    let runId = "";

    for await (const rawEvent of stream) {
      if (abortController.signal.aborted) break;

      const event = rawEvent as unknown as StreamEvent;

      if (event.run_id) runId = event.run_id as string;

      if (event.type === "COMPLETE" || event.status === "COMPLETED") {
        const raw = event.result ?? event.resultJson ?? null;
        return {
          run_id: runId,
          status: "COMPLETED",
          result: tryParseJson(raw),
          error: null,
        };
      }

      if (event.type === "ERROR") {
        return {
          run_id: runId,
          status: "FAILED",
          result: null,
          error: {
            code: (event.code as string) || "AGENT_ERROR",
            message: (event.message as string) || (event.error as string) || "Agent failed",
            category: (event.category as string) || "runtime",
          },
        };
      }
    }

    // Stream ended without a COMPLETE/ERROR event
    return {
      run_id: runId,
      status: "FAILED",
      result: null,
      error: {
        code: "NO_RESULT",
        message: "Agent stream ended without a result",
        category: "runtime",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
