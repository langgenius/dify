import type { MockInstance } from 'vite-plus/test'
import { beforeEach } from 'vite-plus/test'

type FetchMock = Pick<MockInstance<typeof fetch>, 'mock'>

/** The request a mocked `fetch` call sent, rebuilt so its method, headers and body can be read. */
export const getSentRequest = (fetchMock: FetchMock, index = 0) => {
  const call = fetchMock.mock.calls[index]
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`)
  return new Request(...call)
}

type FetchHandler = (
  url: string,
  init: RequestInit,
  options: { request: Request },
) => Promise<Response> | Response

/**
 * Answers every `fetch` in this test file with `handler`, which also receives the sent `Request`
 * so tests can read its method, headers and body. Test files run isolated, so this does not leak.
 */
export function routeFetchTo(handler: FetchHandler) {
  const routedFetch: typeof fetch = async (input, init) =>
    handler(input instanceof Request ? input.url : String(input), init ?? {}, {
      request: new Request(input, init),
    })
  beforeEach(() => {
    globalThis.fetch = routedFetch
  })
}
