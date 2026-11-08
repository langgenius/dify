// Testing the SSE helper requires importing the module under test directly.
// oxlint-disable-next-line no-restricted-imports
import { sseGeneratorPost } from '../base'

vi.mock('@/utils/var', () => ({
  basePath: '/app',
  API_PREFIX: '/console/api',
  PUBLIC_API_PREFIX: '/api',
}))

const makeStreamResponse = (chunks: Uint8Array[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
  )
const encode = (text: string) => new TextEncoder().encode(text)

describe('sseGeneratorPost', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('streams plan then result events, hands back an AbortController, and completes', async () => {
    const planFrame = `data: ${JSON.stringify({ event: 'plan', title: 'X', nodes: [] })}\n\n`
    const resultFrame = `data: ${JSON.stringify({ event: 'result', graph: { nodes: [] } })}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeStreamResponse([encode(planFrame), encode(resultFrame)])),
    )

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
    expect(new URL(String(calledUrl), window.location.origin).pathname).toBe(
      '/console/api/workflow-generate/stream',
    )
    expect(calledOpts).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ mode: 'workflow' }),
      signal: controller!.signal,
    })
  })

  it('reassembles a frame even when a UTF-8 character is split across chunks', async () => {
    const result = { event: 'result', graph: { nodes: [{ id: 'node-1', title: '测试' }] } }
    const bytes = encode(`data: ${JSON.stringify(result)}\n\n`)
    const split = bytes.findIndex((byte) => byte >= 128) + 1
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeStreamResponse([bytes.slice(0, split), bytes.slice(split)])),
    )

    const onResult = vi.fn()
    const onCompleted = vi.fn()
    sseGeneratorPost('/workflow-generate/stream', {}, { onResult, onCompleted })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result)
  })

  it('reports a non-2xx (non-401) response through onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: 'Server Error' }, { status: 500 })),
    )

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
