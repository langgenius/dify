# `provider.py` — WaterCrawlProvider

## Role

Orchestrates WaterCrawl crawl/scrape flows via `WaterCrawlAPIClient`. Maps API payloads to Dify crawl status and structured page data.

## Invariants

- `WaterCrawlAPIClient.process_response` is typed as a broad union (`dict | bytes | list | None | Generator`). Endpoints used here are expected to return JSON objects; non-dict responses are treated as errors via `_require_json_dict`.

## Verification

- `uv run --project api pyright core/rag/extractor/watercrawl/provider.py`
- Relevant unit coverage: `api/tests/unit_tests/core/datasource/test_website_crawl.py` (mocks `WaterCrawlAPIClient`).
