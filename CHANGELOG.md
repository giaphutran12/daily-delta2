# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1.3] - 2026-07-14

### Fixed

- Registered one inert, event-only tombstone while Inngest is disabled so production sync can remove the old cron and workflow registrations; Inngest rejects an empty function list.

## [0.0.1.2] - 2026-07-14

### Changed

- Suspended all Daily Delta Inngest functions, including the daily cron, to stop scheduled and manual pipeline runs from polluting the shared production dashboard.
- Made pipeline trigger requests return `503` and stopped competitor creation from queuing background refreshes while Inngest is disabled.

### Documentation

- Documented the production sync required to deregister the previously deployed Inngest functions.

## [0.0.1.1] - 2026-04-15

### Changed

- Pointed TinyFish public search and fetch calls at the documented public API base paths instead of the incorrect Agent-style routes.

### Fixed

- Corrected the benchmark helper and service tests so they verify the public TinyFish Search and Fetch API shapes that return JSON successfully.

## [0.0.1.0] - 2026-04-13

### Added

- Added an Exa-backed retrieval provider so the pipeline can search with Exa and fetch page contents through a shared provider layer.
- Added a Vitest test lane, CI workflow, and service-level tests for retrieval defaults and endpoint wiring.

### Changed

- Switched the production retrieval defaults to the benchmark winner: Exa search plus raw fetch.
- Moved TinyFish REST search and fetch calls onto the live `/v1/search` and `/v1/fetch` endpoints.

### Fixed

- Fixed the broken TinyFish REST URLs that were returning HTML 404 pages instead of JSON API responses.
