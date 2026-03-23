const TINYFISH_SSE_URL = "https://agent.tinyfish.ai/v1/automation/run-sse";
const TINYFISH_SYNC_URL = "https://agent.tinyfish.ai/v1/automation/run";
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 10_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startTinyfishAgent(
  config: TinyfishRequest,
  callbacks: TinyfishCallbacks,
): AbortController {
  const controller = new AbortController();
  const apiKey = process.env.TINYFISH_API_KEY;

  if (!apiKey) {
    callbacks.onError("TINYFISH_API_KEY not configured");
    return controller;
  }

  const collectedSteps: string[] = [];
  let completedNormally = false;

  const timeout = setTimeout(() => {
    controller.abort();
    if (!completedNormally) {
      if (collectedSteps.length > 0) {
        console.warn(
          "[TinyFish] Agent timed out after 10 min. Last steps:",
          collectedSteps.slice(-10).join(" | "),
        );
      }
      callbacks.onComplete({ signals: [] });
    }
  }, AGENT_TIMEOUT_MS);

  callbacks.onConnecting();

  const run = async (): Promise<void> => {
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const response = await fetch(TINYFISH_SSE_URL, {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: config.url,
            goal: config.goal,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const isRetryable =
            RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttempts;

          if (isRetryable) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }

          throw new Error(
            `TinyFish API error: ${response.status} ${response.statusText}`,
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let streamingUrlSent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "STREAMING_URL" && data.streaming_url && !streamingUrlSent) {
                streamingUrlSent = true;
                callbacks.onStreamingUrl(data.streaming_url);
                callbacks.onBrowsing("Agent is browsing the website...");
              }

              if (data.type === "PROGRESS" && data.purpose) {
                collectedSteps.push(data.purpose);
                callbacks.onStatus(data.purpose);
              }

              if (data.type === "STEP" || (!data.type && (data.purpose || data.action))) {
                const message =
                  data.message || data.purpose || data.action || "Processing...";
                collectedSteps.push(message);
                callbacks.onStatus(message);
              }

              if (data.type === "COMPLETE" || data.status === "COMPLETED") {
                completedNormally = true;
                const raw = data.result ?? data.resultJson ?? null;
                let result: unknown;
                try {
                  result = typeof raw === "string" ? JSON.parse(raw) : raw;
                } catch {
                  result = raw;
                }
                if (data.status === "COMPLETED" || !data.error) {
                  callbacks.onComplete(result);
                } else {
                  callbacks.onError(data.error || "Agent run failed");
                }
              }

              if (data.type === "ERROR") {
                callbacks.onError(data.message || data.error || "Agent encountered an error");
              }
            } catch {}
          }
        }

        return;
      } catch (err) {
        const error = err as Error;

        if (error.name === "AbortError") {
          return;
        }

        callbacks.onError(error.message);
        return;
      }
    }
  };

  run().finally(() => {
    clearTimeout(timeout);
  });

  return controller;
}

export interface TinyfishSyncResponse {
  run_id: string;
  status: "COMPLETED" | "FAILED";
  result: unknown;
  error: { code: string; message: string; category: string } | null;
}

export async function runTinyfishAgentSync(
  config: TinyfishRequest,
): Promise<TinyfishSyncResponse> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error("TINYFISH_API_KEY not configured");

  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(TINYFISH_SYNC_URL, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: config.url, goal: config.goal }),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttempts) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new Error(`TinyFish API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as TinyfishSyncResponse;
  }

  throw new Error("TinyFish API: max retries exceeded");
}

