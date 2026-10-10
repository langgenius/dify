import type { Dispatcher } from 'undici'

export type FetchInit = RequestInit & {
  dispatcher?: Dispatcher
  tls?: { rejectUnauthorized: boolean }
}

export type FetchInitOptions = Readonly<{
  insecure: boolean
  dispatcher?: Dispatcher
}>

// Shared by src/plugins/http.ts and src/auth/device-api.ts: both send requests
// that may need TLS verification skipped and/or routed through a proxy dispatcher.
export function buildFetchInit(base: RequestInit, opts: FetchInitOptions): FetchInit {
  const init: FetchInit = { ...base }
  if (opts.insecure) init.tls = { rejectUnauthorized: false }
  if (opts.dispatcher !== undefined) init.dispatcher = opts.dispatcher
  return init
}
