import type { Dispatcher, RequestInit } from 'undici'

export type FetchInit = RequestInit

export type FetchInitOptions = Readonly<{
  dispatcher?: Dispatcher
}>

// Keep request options on the same undici version as our proxy/TLS dispatcher.
// Node 24 global fetch uses an older, incompatible dispatcher protocol.
export function buildFetchInit(base: RequestInit, opts: FetchInitOptions): FetchInit {
  const init: FetchInit = { ...base }
  if (opts.dispatcher !== undefined) init.dispatcher = opts.dispatcher
  return init
}
