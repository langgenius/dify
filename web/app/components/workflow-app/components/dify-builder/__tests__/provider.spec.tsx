import type { DifyBuilderSessionViewResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDifyBuilder } from '../context'
import { DifyBuilderProvider } from '../provider'

const serviceMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  fetchSession: vi.fn(),
  refreshDraft: vi.fn(),
  setCanvasReadOnly: vi.fn(),
  submitAction: vi.fn(),
  syncDraft: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      appId: string
      setCanvasReadOnly: (locked: boolean) => void
    }) => T,
  ): T =>
    selector({
      appId: 'app-1',
      setCanvasReadOnly: serviceMocks.setCanvasReadOnly,
    }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: <T,>(
    selector: (state: {
      doSyncWorkflowDraft: () => Promise<void>
      handleRefreshWorkflowDraft: () => Promise<void>
    }) => T,
  ): T =>
    selector({
      doSyncWorkflowDraft: serviceMocks.syncDraft,
      handleRefreshWorkflowDraft: serviceMocks.refreshDraft,
    }),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      edges: [],
      getNodes: () => [],
    }),
  }),
}))

vi.mock('@/service/client', async () => {
  const { skipToken } = await import('@tanstack/react-query')
  type SessionQueryOptions = {
    input: typeof skipToken | { params: { session_id: string } }
    refetchInterval?: unknown
  }

  return {
    consoleClient: {
      difyBuilder: {
        sessions: {
          post: serviceMocks.createSession,
          bySessionId: {
            actions: {
              post: serviceMocks.submitAction,
            },
          },
        },
      },
    },
    consoleQuery: {
      difyBuilder: {
        sessions: {
          bySessionId: {
            get: {
              queryOptions: ({ input, ...options }: SessionQueryOptions) => {
                if (typeof input === 'symbol') {
                  return {
                    ...options,
                    queryKey: ['dify-builder-session', null],
                    queryFn: skipToken,
                  }
                }

                const sessionId = input.params.session_id
                return {
                  ...options,
                  queryKey: ['dify-builder-session', sessionId],
                  queryFn: () => serviceMocks.fetchSession(sessionId),
                }
              },
            },
          },
        },
      },
    },
  }
})

const sessionView: DifyBuilderSessionViewResponse = {
  actions: [],
  app_id: 'app-1',
  canvas_read_only: false,
  conversation: [],
  entry_mode: 'build',
  interrupted: false,
  phase: 'analyze',
  run_status: 'waiting_input',
  session_id: 'session-1',
  state: 'build.goal_analysis',
  version: 1,
}

const Probe = () => {
  const { error, startPrompt, submitAction } = useDifyBuilder()
  return (
    <>
      <button type="button" onClick={() => void startPrompt('Build a workflow')}>
        Start
      </button>
      <button type="button" onClick={() => void submitAction('approve_plan')}>
        Submit action
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}

const renderProvider = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
        staleTime: Infinity,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <DifyBuilderProvider>
        <Probe />
      </DifyBuilderProvider>
    </QueryClientProvider>,
  )
}

const recoveredStreamResponse = () => {
  const frame = `event: snapshot\ndata: ${JSON.stringify(sessionView)}\n\n`
  const pendingRead = new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)
  const read = vi
    .fn<() => Promise<ReadableStreamReadResult<Uint8Array>>>()
    .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(frame) })
    .mockReturnValueOnce(pendingRead)

  return {
    ok: true,
    body: {
      getReader: () => ({ read }),
    },
  } as unknown as Response
}

describe('DifyBuilderProvider stream recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.createSession.mockResolvedValue(sessionView)
    serviceMocks.fetchSession.mockResolvedValue(sessionView)
    serviceMocks.refreshDraft.mockResolvedValue(undefined)
    serviceMocks.syncDraft.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes a connection error after the stream delivers a valid frame', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Stream disconnected'))
      .mockResolvedValueOnce(recoveredStreamResponse())
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Stream disconnected'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2500 })
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('keeps an action error visible when the stream recovers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Stream disconnected'))
      .mockResolvedValueOnce(recoveredStreamResponse())
    vi.stubGlobal('fetch', fetchMock)
    serviceMocks.submitAction.mockRejectedValueOnce(new Error('Action failed'))
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Stream disconnected'))
    await user.click(screen.getByRole('button', { name: 'Submit action' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Action failed'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2500 })
    expect(screen.getByRole('alert')).toHaveTextContent('Action failed')
  })
})
