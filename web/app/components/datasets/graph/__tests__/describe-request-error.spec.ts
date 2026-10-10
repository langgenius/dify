import { describe, expect, it } from 'vite-plus/test'
import { describeRequestError } from '../describe-request-error'

describe('describeRequestError', () => {
  it('reports the status of an HTTP failure', () => {
    expect(
      describeRequestError(new Response(null, { status: 503, statusText: 'Service Unavailable' })),
    ).toBe('HTTP 503 Service Unavailable')
  })

  it('omits a missing status text rather than printing a trailing space', () => {
    expect(describeRequestError(new Response(null, { status: 500 }))).toBe('HTTP 500')
  })

  it('reports why a request never completed', () => {
    expect(describeRequestError(new Error('Failed to fetch'))).toBe('Failed to fetch')
  })

  // An aborted request rejects with a DOMException that carries no message.
  it.each([new DOMException(), 'boom', undefined])(
    'leaves nothing to show for %s, so no empty detail box is drawn',
    (error) => {
      expect(describeRequestError(error)).toBeUndefined()
    },
  )
})
