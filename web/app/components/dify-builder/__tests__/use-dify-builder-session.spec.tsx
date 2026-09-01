import type { ReactNode } from 'react'
import type { SessionView } from '@dify/contracts/dify-builder'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useDifyBuilderSession } from '../use-dify-builder-session'

const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  session_id: 'session-1',
  app_id: 'app-1',
  version: 1,
  state: 'fix.diagnose',
  canvas_read_only: true,
  run_status: 'executing',
  interrupted: false,
  conversation: [],
  ...overrides,
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const renderSessionHook = () => {
  const store = createStore()
  return renderHook(
    () =>
      useDifyBuilderSession({
        baseUrl: 'http://localhost:5001/console/api',
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  )
}

describe('useDifyBuilderSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.cookie = 'csrf_token=; Max-Age=0; path=/'
  })

  it('should use only CORS-approved headers when creating a session', async () => {
    document.cookie = 'csrf_token=test-csrf-token; path=/'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }))
    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.startFix('app-1', 'run-1')
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe('http://localhost:5001/console/api/dify-builder/sessions')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token')
    expect(headers.has('X-Workspace-Id')).toBe(false)
  })

  it('refreshes the full conversation after a streamed state update', async () => {
    const initialView = createSessionView()
    const latestView = createSessionView({
      version: 2,
      state: 'fix.await_approval',
      canvas_read_only: false,
      run_status: 'waiting_input',
      conversation: [
        {
          seq: 1,
          at_version: 2,
          kind: 'notice',
          payload: { text: 'Repair plan ready' },
        },
      ],
    })
    const stateFrame = `event: state\ndata: ${JSON.stringify({
      version: 2,
      state: latestView.state,
      canvas_read_only: false,
      run_status: latestView.run_status,
      actions: [],
    })}\n\n`
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') return jsonResponse(initialView, 201)
      if (url.endsWith('/stream')) return new Response(stateFrame)
      return jsonResponse(latestView)
    })
    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.startFix('app-1', 'run-1')
    })

    await waitFor(() => {
      expect(result.current.view?.version).toBe(2)
      expect(result.current.view?.conversation[0]?.payload).toEqual({
        text: 'Repair plan ready',
      })
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:5001/console/api/dify-builder/sessions/session-1',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('stays busy after an action until the streamed version advances', async () => {
    const waitingView = createSessionView({
      state: 'fix.await_approval',
      canvas_read_only: false,
      run_status: 'waiting_input',
    })
    const advancedView = createSessionView({
      version: 2,
      state: 'fix.await_verify',
      canvas_read_only: false,
      run_status: 'waiting_input',
    })
    let streamCount = 0
    let actionStreamController: ReadableStreamDefaultController<Uint8Array> | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/sessions')) return jsonResponse(waitingView, 201)
      if (url.endsWith('/actions')) return jsonResponse(waitingView)
      if (url.endsWith('/stream')) {
        streamCount += 1
        if (streamCount === 1) return new Response('')
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              actionStreamController = controller
            },
          }),
        )
      }
      return jsonResponse(advancedView)
    })
    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.startFix('app-1', 'run-1')
    })
    await act(async () => {
      await result.current.runAction('approve_plan')
    })

    expect(result.current.isBusy).toBe(true)

    await act(async () => {
      actionStreamController?.enqueue(
        new TextEncoder().encode(
          `event: state\ndata: ${JSON.stringify({
            version: 2,
            state: advancedView.state,
            canvas_read_only: false,
            run_status: advancedView.run_status,
            actions: [],
          })}\n\n`,
        ),
      )
      actionStreamController?.close()
    })

    await waitFor(() => {
      expect(result.current.isBusy).toBe(false)
      expect(result.current.view?.version).toBe(2)
    })
  })
})
