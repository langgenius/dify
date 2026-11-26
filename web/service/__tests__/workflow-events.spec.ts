import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { workflowRunEventsRequest } from '../workflow-events'

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

const eventStreamResponse = () =>
  new Response('data: {"event":"workflow_paused"}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  })

const fetchedURL = () => {
  const [input] = vi.mocked(globalThis.fetch).mock.calls[0]!
  return new URL(input instanceof Request ? input.url : String(input))
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('workflowRunEventsRequest', () => {
  it('resumes console workflow run events with the state snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(eventStreamResponse()))
    const controller = new AbortController()

    const output = await workflowRunEventsRequest('run-1')({
      signal: controller.signal,
      context: { stream: true },
    })

    const url = fetchedURL()
    expect(url.pathname).toBe('/console/api/workflow/run-1/events')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      include_state_snapshot: 'true',
      continue_on_pause: 'true',
    })
    const frames: unknown[] = []
    for await (const frame of output as AsyncIterable<unknown>) frames.push(frame)
    expect(frames).toEqual([{ event: 'workflow_paused' }])
  })

  it.each([
    { page: '/workflow/app-code', apiPath: '/api/workflow/run-1/events' },
    {
      page: '/environment/workflow/env-code',
      apiPath: '/api/environment/env-code/workflow/run-1/events',
    },
  ])('keeps the WebApp API path and stream query on $page', async ({ page, apiPath }) => {
    window.history.replaceState({}, '', page)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(eventStreamResponse()))

    await workflowRunEventsRequest('run-1', { isPublicAPI: true })({
      signal: new AbortController().signal,
      context: { stream: true },
    })

    const url = fetchedURL()
    expect(url.pathname).toBe(apiPath)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      include_state_snapshot: 'true',
      continue_on_pause: 'true',
    })
  })
})
