# ADR 0007: Keep Marketplace analytics owned by its host

Status: Accepted (existing behavior)
Date: 2026-11-23
Owner: `web/utils/marketplace-site-track.ts`

## Context

Shared Marketplace UI is used by both the Dify console and the standalone Marketplace. Only the standalone host owns the analytics producer.

## Decision

Use the document's `data-is-marketplace` marker to gate calls into `window.__marketplaceTracking__`. The console sets the marker to false and does not provide this bridge, so shared helpers are no-ops there. The standalone `dify-marketplace` host sets the marker and injects its analytics runtime.

## Consequences

Do not initialize a second analytics producer in shared UI. Host integration must supply the marker and bridge together; optional bridge access preserves the current no-op behavior when unavailable.
