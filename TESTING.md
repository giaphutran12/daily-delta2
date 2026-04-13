# TESTING

100% test coverage is the goal. Tests make vibe coding safe. Without them, you're guessing. With them, you can move fast and trust the changes.

## Framework

- Runner: `vitest`
- Current focus: fast unit tests for server-side services and endpoint wiring

## Run tests

```bash
npm run test
```

## Test layers

- Unit tests: service helpers, provider selection, endpoint wiring
- Integration tests: add next for route handlers and pipeline flows that cross service boundaries
- Smoke tests: keep `npm run build` green on every branch
- E2E tests: add when we need browser coverage for core user flows

## Conventions

- Put tests under `tests/`
- Name files `*.test.ts`
- Mock network calls and secrets
- When a bug is fixed, add a regression test for the broken path
- When a conditional is added, test both sides
