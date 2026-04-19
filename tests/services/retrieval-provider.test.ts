import { afterEach, describe, expect, it } from "vitest";
import {
  getDefaultFetchProvider,
  getDefaultSearchProvider,
  isSearchBasedDefinition,
} from "../../src/services/retrieval-provider";

const SEARCH_ENV = "DAILY_DELTA_SEARCH_PROVIDER";
const FETCH_ENV = "DAILY_DELTA_FETCH_PROVIDER";

afterEach(() => {
  delete process.env[SEARCH_ENV];
  delete process.env[FETCH_ENV];
});

describe("retrieval provider defaults", () => {
  it("defaults production search to TinyFish", () => {
    expect(getDefaultSearchProvider()).toBe("current");
  });

  it("allows explicit search provider overrides", () => {
    process.env[SEARCH_ENV] = "current";
    expect(getDefaultSearchProvider()).toBe("current");

    process.env[SEARCH_ENV] = "tinyfish";
    expect(getDefaultSearchProvider()).toBe("current");

    process.env[SEARCH_ENV] = "agent";
    expect(getDefaultSearchProvider()).toBe("agent");
  });

  it("defaults fetch to raw and supports exa override", () => {
    expect(getDefaultFetchProvider()).toBe("raw");

    process.env[FETCH_ENV] = "exa";
    expect(getDefaultFetchProvider()).toBe("exa");
  });

  it("classifies search-engine definitions correctly", () => {
    expect(isSearchBasedDefinition("https://google.com/search?q=attio")).toBe(true);
    expect(isSearchBasedDefinition("https://www.techcrunch.com/2026/launch")).toBe(true);
    expect(isSearchBasedDefinition("https://attio.com/blog")).toBe(false);
  });
});
