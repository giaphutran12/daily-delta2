# TinyFish Search/Fetch Report

Date: `2026-04-19`  
Repo: `daily-delta2`

## Executive Summary

We corrected an earlier mistake about TinyFish public endpoint shape, reran the Search/Fetch checks on the correct public endpoints, sanity-checked result quality, and then made a product decision about where TinyFish is strong enough to own the pipeline today.

Current recommendation:

- **Use TinyFish for search**
- **Keep fetch defensive for now** with raw or Exa still available
- **Keep TinyFish agent fallback** for empty or weird search results

Why:

- TinyFish search looked reliable and generally relevant in our sample
- TinyFish search was slightly faster than Exa in sequential mode
- Exa search was still much faster in parallel mode
- TinyFish fetch improved once the correct public endpoint was used, but it still has provider-specific failure modes
- Exa fetch also has provider-specific failure modes, so neither fetch provider is perfect

## 1. Public Endpoint Correction

Correct public endpoints:

- Search: `GET https://api.search.tinyfish.ai`
- Fetch: `POST https://api.fetch.tinyfish.ai`

What was wrong before:

- using `/search` and `/fetch` suffixes on those public domains
- mixing the public Search/Fetch APIs with the separate agent/automation surface

Live probe:

- `GET https://api.search.tinyfish.ai?query=test` -> `200` JSON
- `GET https://api.search.tinyfish.ai/search?query=test` -> `404` HTML
- `POST https://api.fetch.tinyfish.ai` -> `200` JSON
- `POST https://api.fetch.tinyfish.ai/fetch` -> `404` HTML

Repo status:

- public endpoint correction already shipped in PR #50

## 2. Search Benchmark

Same 10 queries, same set for both providers:

1. `Donald Trump`
2. `OpenAI API pricing`
3. `Perplexity AI funding`
4. `Stripe blog AI`
5. `Figma Dev Mode`
6. `Notion calendar`
7. `Anthropic Claude pricing`
8. `Datadog incident management`
9. `Canva enterprise`
10. `Linear issue tracking`

### TinyFish public search

Sequential:
- total wall time: `10.64s`
- success: `10/10`
- failures: `0/10`
- avg latency: `1.06s/query`

Parallel:
- total wall time: `4.18s`
- success: `10/10`
- failures: `0/10`
- avg latency: `1.47s/query`

### Exa search

Sequential:
- total wall time: `12.29s`
- success: `10/10`
- failures: `0/10`
- avg latency: `1.23s/query`

Parallel:
- total wall time: `0.66s`
- success: `10/10`
- failures: `0/10`
- avg latency: `0.36s/query`

### Search takeaway

- TinyFish search did **not fail at all** in the sample
- TinyFish was slightly faster than Exa in sequential mode
- Exa was dramatically faster in parallel mode

## 3. Search Result Quality

This was a manual sanity check on top titles/URLs/snippets. Goal: make sure relevance was real, not just timing.

Summary:

- both TinyFish and Exa were generally on-topic
- no obvious absurd mismatch like "Trump -> dogs"
- Exa results were usually cleaner / more canonical
- TinyFish looked more like broad web search and sometimes included noisier community/video results

Examples:

- `Donald Trump`
  - TinyFish: Wikipedia, White House related pages, official/social profiles
  - Exa: Wikipedia, CNN, official site, Britannica
- `Stripe blog AI`
  - TinyFish: Stripe AI posts + blog pages
  - Exa: Stripe AI/product pages, generally cleaner
- `Datadog incident management`
  - both returned docs/product/resources that were clearly relevant

Takeaway:

- TinyFish search quality looked good enough to be credible
- Exa still had an edge in cleanliness/canonicality

## 4. Fetch Benchmark

Same 5 URLs:

1. `https://example.com`
2. `https://httpbin.org/html`
3. `https://news.ycombinator.com/`
4. `https://stripe.com/blog`
5. `https://posthog.com/careers`

### TinyFish fetch

Batch:
- wall time: `11.70s`
- success: `4/5`
- failure: `1/5`
- failed URL: `https://stripe.com/blog` -> `proxy_error`

Sequential:
- wall time: `14.30s`
- success: `4/5`
- failure: `1/5`
- failed URL: `https://stripe.com/blog` -> `proxy_error`

### Exa fetch

Batch:
- success: `4/5`
- failure: `1/5`
- failed URL: `https://httpbin.org/html` -> `SOURCE_NOT_AVAILABLE`

Meaningful note:
- Exa did return partial success in batch, the 4 good URLs still came back

### Fetch takeaway

- TinyFish batching beat TinyFish sequential fetch in the sample
- TinyFish and Exa failed on different URLs
- TinyFish missed Stripe
- Exa missed `httpbin/html`
- both fetch providers can fail, just differently

## 5. Important Edge Cases

### Mixed valid + invalid URLs in TinyFish fetch

If a TinyFish fetch batch mixes valid and invalid URLs:

- whole request fails with `400 INVALID_INPUT`
- there is no partial success response

Implication:

- if we want partial success client-side, pre-validate URLs first
- or fan out single-URL requests and wrap them in `Promise.allSettled`

### Rate-limit sanity check

Small burst checks did **not** show rate limits as the dominant issue:

- `6` concurrent TinyFish search requests -> all `200`
- `3` concurrent TinyFish fetch requests -> all `200`

This does not prove rate limits never happen. It does mean the spot checks did not show a strong `429` signature.

## 6. SDK / Implementation Note

For the Search/Fetch benchmarking:

- I was **not** using the TinyFish CLI
- I was **not** using TinyFish agent automation
- I was using direct HTTP requests from Node scripts to the public Search/Fetch APIs

Why:

- the installed `@tiny-fish/sdk` package in this repo exposes `agent.*` and `runs.*`
- it does **not** expose dedicated public `search()` / `fetch()` helpers

So for Search/Fetch benchmarking, direct HTTP was the actual available interface here.

## 7. Product Decision

This is the actual decision layer, not just benchmark trivia.

### What looks ready

**Search**
- TinyFish search looks good enough to own this first step
- reliable in the sample
- relevant enough in the sample
- slightly better sequential performance

### What does not look ready to fully replace the pipeline

**Fetch**
- TinyFish fetch still has provider-specific failures
- Exa fetch also fails sometimes, so this is not "Exa perfect, TinyFish broken"
- still, TinyFish fetch is not yet strong enough to justify replacing the entire fetch layer on benchmark evidence alone

### Current recommended production shape

- **TinyFish search**
- **raw / Exa fetch kept defensive**
- **TinyFish agent fallback** when TinyFish search returns 0 usable URLs or we hit weird site behavior

That gives the product a real TinyFish-first path without forcing the whole stack onto the weakest moving part.

## 8. Repo Changes After This Decision

Local code change prepared on top of the corrected public endpoints:

- default search provider switched from Exa to TinyFish
- `DAILY_DELTA_SEARCH_PROVIDER=tinyfish` works as an explicit alias
- if TinyFish search returns `0` usable URLs, pipeline falls back to TinyFish agent search

Verification on that change:

- `npm run test` passed
- `npm run build` passed

## 9. Bottom Line

What changed from the earlier story:

- the earlier endpoint assumption was wrong
- that part is corrected

What still holds:

- TinyFish search is real enough to use
- Exa still wins hard for highly parallel search
- TinyFish fetch is not yet enough reason to replace the whole pipeline

Recommended action:

- move prod search to TinyFish first
- do not replace the whole pipeline end-to-end yet
