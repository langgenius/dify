import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: 'https://6bf48a450f054d749398c02a61bae343@o4505264807215104.ingest.sentry.io/4505264809115648',

  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for performance monitoring.
  // We recommend adjusting this value in production
  tracesSampleRate: 1.0,

  // ...

  // Note: if you want to override the automatic release value, do not set a
  // `release` value here - use the environment variable `SENTRY_RELEASE`, so
  // that it will also get attached to your source maps
})
