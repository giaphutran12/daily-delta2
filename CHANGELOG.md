# Changelog

All notable changes to this project will be documented in this file.

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
