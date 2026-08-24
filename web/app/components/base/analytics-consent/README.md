# Analytics Consent

This module owns CookieYes consent state and the Dify Cloud analytics boundary.

- `request-boundary.ts` decides whether a request is eligible for Cloud analytics before client code mounts.
- `cookieyes-consent-bridge.tsx` is the only CookieYes-to-application state adapter.
- `consent-store.ts` owns the client consent snapshot; analytics consumers must gate SDK activation or event emission on that snapshot.
- `cloud-analytics.tsx` gates analytics scripts and runtime mounting by deployment, environment, host, and route.
- `cloud-analytics-runtime.tsx` mounts the consent bridge and client analytics consumers.

Amplitude, Google Analytics, attribution, and other consumers must depend on this boundary instead of reading CookieYes state directly.
