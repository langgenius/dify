// Build-time globals injected by vite-plus. Single source of truth — both
// info.ts (client identity) and compat.ts (supported dify range) read from
// here. Values are computed in scripts/lib/resolve-buildinfo.ts.
declare const __DIFYCTL_VERSION__: string
declare const __DIFYCTL_COMMIT__: string
declare const __DIFYCTL_BUILD_DATE__: string
declare const __DIFYCTL_CHANNEL__: string
declare const __DIFYCTL_MIN_DIFY__: string
declare const __DIFYCTL_MAX_DIFY__: string
