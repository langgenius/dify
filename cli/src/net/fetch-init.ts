import type { Dispatcher, RequestInit } from 'undici'

export type FetchInit = RequestInit & {
  tls?: { rejectUnauthorized: boolean }
}

export type FetchInitOptions = Readonly<{
  insecure: boolean
  dispatcher?: Dispatcher
}>

// Keep request options on the same undici version as our proxy/TLS dispatcher.
// Node 24 global fetch uses an older, incompatible dispatcher protocol.
export function buildFetchInit(base: RequestInit, opts: FetchInitOptions): FetchInit {
  const init: FetchInit = { ...base }
  // Bun replaces undici with its native fetch and ignores the dispatcher.
  // Keep its TLS option alongside the dispatcher used by Node.
  if (opts.insecure) init.tls = { rejectUnauthorized: false }
  if (opts.dispatcher !== undefined) init.dispatcher = opts.dispatcher
  return init
}
