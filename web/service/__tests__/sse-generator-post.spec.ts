// Testing the SSE helper requires importing the module under test directly.
// eslint-disable-next-line no-restricted-imports
import { sseGeneratorPost } from '../base'

vi.mock('@/utils/var', () => ({
  basePath: '/app',
  API_PREFIX: '/console/api',
  PUBLIC_API_PREFIX: '/api',
  IS_CE_EDITION: false,
}))

// Minimal streaming Response: a body whose reader yields the given chunks in
// order, then signals done. ``json()`` backs the non-2xx error path.
const makeStreamResponse = (chunks: string[], status = 200) => {
  const encoder = new TextEncoder()
  let i = 0
  return {
    status,
    body: {
      getReader: () => ({
        read: () =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: encoder.encode(chunks[i++]) })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
    json: () => Promise.resolve({ message: 'Server Error' }),
  } as unknown as Response
}

describe('sseGeneratorPost', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('streams plan then result events, hands back an AbortController, and completes', async () => {
    const planFrame = `data: ${JSON.stringify({ event: 'plan', title: 'X', nodes: [] })}\n\n`
    const resultFrame = `data: ${JSON.stringify({ event: 'result', graph: { nodes: [] } })}\n\n`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse([planFrame, resultFrame])))

    const onPlan = vi.fn()
    const onResult = vi.fn()
    const onCompleted = vi.fn()
    const onError = vi.fn()
    let controller: AbortController | undefined

    sseGeneratorPost(
      '/workflow-generate/stream',
      { mode: 'workflow' },
      {
        onPlan,
        onResult,
        onCompleted,
        onError,
        getAbortController: (c) => {
          controller = c
        },
      },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))

    expect(controller).toBeInstanceOf(AbortController)
    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({ event: 'plan', title: 'X' }))
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ event: 'result' }))
    expect(onError).not.toHaveBeenCalled()
    // POSTs to the prefixed stream URL.
    const [calledUrl, calledOpts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(calledUrl)).toContain('/workflow-generate/stream')
    expect((calledOpts as RequestInit).method).toBe('POST')
  })

  it('reassembles a JSON frame split across chunk boundaries', async () => {
    const frame = JSON.stringify({ event: 'result', graph: { nodes: [] } })
    const part1 = `data: ${frame.slice(0, 10)}`
    const part2 = `${frame.slice(10)}\n\n`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse([part1, part2])))

    const onResult = vi.fn()
    const onCompleted = vi.fn()
    sseGeneratorPost('/workflow-generate/stream', {}, { onResult, onCompleted })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('reports a non-2xx (non-401) response through onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse([], 500)))

    const onError = vi.fn()
    sseGeneratorPost('/workflow-generate/stream', {}, { onError })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Server Error'))
  })

  it('reports a rejected fetch through onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const onError = vi.fn()
    sseGeneratorPost('/workflow-generate/stream', {}, { onError })

    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onError.mock.calls[0]![0]).toContain('network down')
  })
})
