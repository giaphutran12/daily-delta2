import { afterEach, describe, expect, it, vi } from "vitest";
import { tinyfishFetch, tinyfishSearch } from "../../src/services/tinyfish-client";

const API_KEY_ENV = "TINYFISH_API_KEY";

afterEach(() => {
  delete process.env[API_KEY_ENV];
  vi.restoreAllMocks();
});

describe("tinyfish REST endpoints", () => {
  it("calls the live /v1/search endpoint", async () => {
    process.env[API_KEY_ENV] = "test-key";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          query: "attio",
          results: [
            {
              position: 1,
              site_name: "example.com",
              title: "Attio",
              snippet: "CRM",
              url: "https://example.com/attio",
            },
          ],
          total_results: 1,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await tinyfishSearch("attio", { language: "en" });

    expect(result.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain("https://agent.tinyfish.ai/v1/search");
    expect(url.searchParams.get("query")).toBe("attio");
    expect(url.searchParams.get("language")).toBe("en");
    expect(init.headers).toEqual({ "X-API-Key": "test-key" });
  });

  it("calls the live /v1/fetch endpoint", async () => {
    process.env[API_KEY_ENV] = "test-key";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://example.com",
              final_url: "https://example.com",
              title: "Example",
              description: null,
              language: "en",
              author: null,
              published_date: null,
              text: "Example content",
            },
          ],
          errors: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await tinyfishFetch(["https://example.com"], {
      format: "markdown",
    });

    expect(result.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://agent.tinyfish.ai/v1/fetch");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-API-Key": "test-key",
    });
    expect(init.body).toBe(
      JSON.stringify({
        urls: ["https://example.com"],
        format: "markdown",
      }),
    );
  });
});
