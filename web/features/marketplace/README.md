# Marketplace

This module owns Marketplace availability, URLs, asset addresses, and shared generated queries.

- `client.ts` gates links and queries with the deployment capability. Search selectors receive the generated `MarketplacePlugin` response shape; this boundary does not impose a plugin card or installation model.
- `links.ts` owns navigation addresses; `api.ts` owns API and asset addresses.
- Plugin card conversion belongs to `app/components/plugins/marketplace/plugin-card-adapter.ts`. Plugin UI and other presentation consumers apply that adapter after reading Marketplace data. The shared feature does not import plugin UI types or utilities.

The Marketplace import rule enforces availability-sensitive access through `client.ts` for Console consumers. Marketplace's own UI and service transport retain their scoped exceptions.
