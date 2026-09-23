# Analytics Consent

This module owns CookieYes consent state and the Dify Cloud analytics boundary.

- `request-boundary.ts` decides whether the deployment, environment, and host are eligible for Cloud analytics before client code mounts.
- `cloud-analytics-layout-boundary.tsx` uses the active Next.js route group to select the console or WebApp analytics scripts and runtime without maintaining URL path exclusions. Google Analytics is mounted only for the console branch.
- `cookieyes-consent-bridge.tsx` is the only CookieYes-to-application state adapter.
- `consent-store.ts` owns the client consent snapshot; analytics consumers must gate SDK activation or event emission on that snapshot.
- `cloud-analytics.tsx` gates analytics scripts and runtime mounting by deployment, environment, and host.
- `console-analytics-runtime.tsx` mounts the full Amplitude configuration and external-attribution consumers.
- `web-app-analytics-runtime.tsx` mounts consent and the dedicated custom-event-only Amplitude provider. It must not mount Google Analytics, automatic Amplitude tracking, session replay, or external attribution.

Amplitude, Google Analytics, attribution, and other consumers must depend on these boundaries instead of reading CookieYes state directly. WebApp components must use `trackWebAppEvent` rather than the console `trackEvent` API.
