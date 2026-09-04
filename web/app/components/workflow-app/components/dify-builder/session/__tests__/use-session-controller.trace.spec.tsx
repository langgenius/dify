import { act } from '@testing-library/react'
import {
  commandStartedEvent,
  conversationPage,
  createSessionView,
  renderSessionHook,
  stateEvent,
  streamOf,
} from './fixtures'

const clientMocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  conversation: vi.fn(),
  stream: vi.fn(),
  action: vi.fn(),
  message: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: clientMocks.create,
        bySessionId: {
          get: clientMocks.get,
          conversation: { get: clientMocks.conversation },
          stream: { get: clientMocks.stream },
          actions: { post: clientMocks.action },
          messages: { post: clientMocks.message },
        },
      },
    },
  },
}))

describe('useDifyBuilderSessionController trace capture', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clientMocks.conversation.mockResolvedValue(conversationPage())
  })

  it('captures outbound commands and inbound frames in order', async () => {
    const started = createSessionView({ version: 1, state: 'build.capability_check' })
    const terminal = createSessionView({
      version: 2,
      state: 'build.plan_approval',
      run_status: 'waiting_input',
    })
    clientMocks.create.mockResolvedValue(
      streamOf(
        commandStartedEvent(started),
        {
          event: 'canvas',
          data: {
            kind: 'canvas',
            session_id: 'session-1',
            operation_id: 'operation-1',
            stage_id: 'build.plan_approval',
            at_version: 1,
            revision: 1,
            event: 'focus_workflow',
          },
        },
        stateEvent(terminal),
      ),
    )

    const { result } = renderSessionHook()
    await act(async () => {
      expect(await result.current.startBuild('app-1', 'make a bot')).toBe(true)
    })

    const { entries } = result.current.getTrace()
    // first entry is the outbound session start, then the inbound frames in arrival order
    expect(entries[0]).toMatchObject({ dir: 'out', kind: 'session_start' })
    const kinds = entries.map((entry) => `${entry.dir}:${entry.kind}`)
    expect(kinds).toContain('in:command_started')
    expect(kinds).toContain('in:canvas')
    expect(kinds).toContain('in:state')
    // seq is strictly increasing
    expect(entries.map((entry) => entry.seq)).toEqual(
      [...entries.map((entry) => entry.seq)].sort((left, right) => left - right),
    )
  })

  it('clears the trace on reset', async () => {
    clientMocks.create.mockResolvedValue(
      streamOf(
        stateEvent(
          createSessionView({
            version: 1,
            state: 'failed',
            run_status: 'failed',
          }),
        ),
      ),
    )
    const { result } = renderSessionHook()
    await act(async () => {
      await result.current.startBuild('app-1', 'x')
    })
    expect(result.current.getTrace().entries.length).toBeGreaterThan(0)

    act(() => {
      result.current.reset()
    })
    expect(result.current.getTrace()).toEqual({ entries: [], truncated: false })
  })

  it('starts a fresh trace buffer for a new session even without an explicit reset', async () => {
    clientMocks.create
      .mockResolvedValueOnce(
        streamOf(
          stateEvent(
            createSessionView({
              session_id: 'session-1',
              version: 1,
              state: 'failed',
              run_status: 'failed',
            }),
          ),
        ),
      )
      .mockResolvedValueOnce(
        streamOf(
          stateEvent(
            createSessionView({
              session_id: 'session-2',
              version: 1,
              state: 'failed',
              run_status: 'failed',
            }),
          ),
        ),
      )

    const { result } = renderSessionHook()
    await act(async () => {
      await result.current.startBuild('app-1', 'first goal')
    })
    expect(result.current.getTrace().entries.length).toBeGreaterThan(0)

    // Second session starts WITHOUT calling reset() in between — this mirrors
    // the real entry path (difyBuilderStartPromptAtom -> startBuild/startEdit),
    // which does not call reset() when the prior session already ended.
    await act(async () => {
      await result.current.startBuild('app-1', 'second goal')
    })

    const { entries } = result.current.getTrace()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ dir: 'out', kind: 'session_start', seq: 1 })
    expect(entries[0].payload).toMatchObject({ goal_text: 'second goal' })
    expect(entries.some((entry) => JSON.stringify(entry.payload).includes('first goal'))).toBe(false)
    expect(entries.some((entry) => JSON.stringify(entry.payload).includes('session-1'))).toBe(false)
  })
})
