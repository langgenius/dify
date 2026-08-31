# Privacy Policy for the MrScraper Dify Plugin

Last updated: August 27, 2026

This policy describes data processing performed by the MrScraper Tool Plugin itself. Use of the MrScraper service is also governed by MrScraper's [Privacy Policy](https://mrscraper.com/privacy-policy), [Data Protection Policy](https://mrscraper.com/data-protection-policy), and other applicable service terms.

## Data sent to MrScraper

To provide the selected tool operation, the plugin sends an API token and some or all of the following user-provided data to MrScraper's API:

- target URLs, search queries, extraction prompts, output schemas, selectors, and URL patterns;
- scraper IDs, result IDs, batch URL arrays, scraper and agent types;
- browser, rendering, proxy, pagination, retry, timeout, output, and screenshot settings;
- manual scraper cookie arrays, cookie-jar values, paginator objects, and proxy settings.

MrScraper processes this data and returns account information, search or crawl data, extracted data, scraper/run records, result records, rendered HTML/text, screenshots, cookies, or related API responses. Target content may contain personal data. Users are responsible for having a lawful basis and all permissions required to submit and process it.

## Credentials

Dify stores the provider-level API token according to the Dify deployment's credential controls and supplies it to the plugin at runtime. The plugin uses the token only to authenticate calls to the three fixed MrScraper API origins. It does not place the token in tool schemas, returned messages, or persistent plugin storage. Error handling redacts the token from bounded upstream and transport error messages.

## Storage and logging

The plugin does not request Dify storage permission and does not implement its own database or persistent cache. It does not intentionally log request payloads, API tokens, or response bodies. Dify, MrScraper, reverse proxies, infrastructure providers, and target websites may independently retain logs or submitted data under their own configuration and policies.

## Data sharing and retention

The plugin transmits operation data directly to MrScraper and does not intentionally share it with another service. MrScraper may use subprocessors as described in its policies. The plugin itself has no retention or deletion facility because it does not persist operation data. Requests concerning data retained by Dify should be directed to the Dify deployment operator; requests concerning MrScraper should be directed to MrScraper.

## User responsibilities

Use this plugin only for content you are authorized to access and process. Do not use it to bypass authentication, collect non-public or sensitive data without authorization, violate website terms, or infringe privacy, copyright, database, or computer-access rights.

## Contact

For plugin issues, use the [source repository issue tracker](https://github.com/ai-mrscraper/dify-plugin-mrscraper/issues). For MrScraper privacy questions, contact `support@mrscraper.com` or use the contact details in MrScraper's privacy policy.
