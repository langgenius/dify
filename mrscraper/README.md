# MrScraper for Dify

MrScraper is a native Dify Tool Plugin for web discovery, page rendering, AI extraction, scraper creation, scraper execution, and result retrieval. One provider-level API token enables 15 independent tools in Dify Agents, Chatflows, and Workflows.

## Setup

1. Sign in to the [MrScraper app](https://app.mrscraper.com) and create or copy an API token.
2. Install this plugin in a compatible Dify instance.
3. Open the MrScraper provider credentials and enter the token under **API Token**.

The credential is validated with the MrScraper account-information endpoint. The token is supplied by Dify at runtime and is not a tool parameter.

## Tools

### Account

- **Get Account Info** — account details, token use, and limits.

### Discovery

- **Crawl Website URLs** — immediately discover URLs from a starting website.
- **Search Google SERP** — synchronous Google results as JSON or exact HTML.

### Extraction

- **Extract Page by Prompt** — immediately extract one page with optional JSON-shape instructions.
- **Extract Listings** — immediately extract repeated or paginated items.
- **Extract Structured Data** — use the bundled Article, Forum Thread, Hotel, Job Posting, Post, Product, Property, Restaurant, Social Media Profile, or Tour/Attraction preset.
- **Fetch Rendered HTML** — render JavaScript in a stealth browser with optional Markdown, screenshot, cookies, selector waiting, geo/proxy settings, and home-page navigation.

### Results

- **Get Results** — paginated results with page size and sort order.
- **Get Latest Results** — the newest N results.
- **Get Result Detail** — one complete result by ID.

### Scraper Creation

- **Create Prompt Scraper** — create a reusable General AI scraper.
- **Create Listing Scraper** — create a reusable Listing AI scraper.
- **Create Website Crawl Scraper** — create a reusable Map AI scraper.

### Scraper Runs

- **Run Existing Scraper AI - General/Listing/Map** — run one URL with the settings supported by that AI agent type.
- **Run Existing Scraper Manual** — run one URL with an existing manual scraper.
- **Run Existing Scraper Batch** — run a nonempty array of URLs through the AI or manual bulk endpoint.

## Examples

An Agent can call **Extract Page by Prompt** with:

```text
url: https://example.com/product/123
prompt: Extract the product name, price, availability, and image URL.
output_schema: {"name":"string","price":"number","in_stock":"boolean","image_url":"string"}
```

For a Workflow, bind a previous node's array output to **Run Existing Scraper Batch**:

```json
{
  "scraper_type": "ai",
  "scraper_id": "cm123abc456",
  "urls": ["https://example.com/a", "https://example.com/b"]
}
```

`output_schema`, `cookies`, and `paginator` accept native structured values. For compatibility with serialized Agent or Workflow values, the boundary also accepts one valid JSON string of the matching top-level type. Comma-splitting and Python-literal parsing are intentionally not used.

## Outputs and timeouts

Upstream JSON objects and top-level arrays are emitted as Dify JSON messages without dropping fields. The pinned Dify Plugin SDK 0.10.2 supports top-level arrays directly, so no wrapper field is added. HTML and plain-text responses are emitted as exact text messages and are never mislabeled as JSON.

Scraping can be slow. The shared client uses a finite 10-second connection timeout and a 620-second default read timeout. Rendered-page calls use the configured page timeout plus a 30-second transport allowance. Dify, reverse proxies, and infrastructure may impose shorter limits.

## Privacy, safety, and support

The plugin sends target URLs, prompts, selectors, output schemas, cookies, paginator settings, and related options to MrScraper. Review [PRIVACY.md](PRIVACY.md), the [MrScraper privacy policy](https://mrscraper.com/privacy-policy), and the [MrScraper acceptable use policy](https://mrscraper.com/acceptable-use-policy).

Only scrape public content or content you are authorized to access. Follow the target site's terms and all applicable privacy, copyright, and computer-access laws.

Source and issue tracking: [ai-mrscraper/dify-plugin-mrscraper](https://github.com/ai-mrscraper/dify-plugin-mrscraper). MrScraper support is available through [mrscraper.com](https://mrscraper.com).
