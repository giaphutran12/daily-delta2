import { afterEach, describe, expect, it, vi } from "vitest";
import { exaGetContents, exaSearch } from "../../src/services/exa-client";

const EXA_KEY_ENV = "EXA_API_KEY";

afterEach(() => {
  delete process.env[EXA_KEY_ENV];
  vi.restoreAllMocks();
});

describe("exa client", () => {
  it("calls the Exa search endpoint", async () => {
    process.env[EXA_KEY_ENV] = "exa-key";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Attio raises",
              url: "https://example.com/attio-raises",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const results = await exaSearch("attio funding", { numResults: 3 });

    expect(results).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.exa.ai/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "exa-key",
    });
    expect(init.body).toBe(
      JSON.stringify({
        query: "attio funding",
        numResults: 3,
      }),
    );
  });

  it("maps Exa contents errors back onto result rows", async () => {
    process.env[EXA_KEY_ENV] = "exa-key";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "ok-1",
              url: "https://example.com/ok",
              title: "OK",
              text: "content",
            },
          ],
          statuses: [
            { id: "ok-1", status: "success" },
            {
              id: "https://example.com/fail",
              status: "error",
              error: { tag: "SOURCE_NOT_AVAILABLE", httpStatusCode: 404 },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const results = await exaGetContents([
      "https://example.com/ok",
      "https://example.com/fail",
    ]);

    expect(results).toEqual([
      {
        url: "https://example.com/ok",
        title: "OK",
        text: "content",
        publishedDate: undefined,
        error: undefined,
      },
      {
        url: "https://example.com/fail",
        title: null,
        text: "",
        publishedDate: undefined,
        error: "SOURCE_NOT_AVAILABLE (404)",
      },
    ]);
  });
});
