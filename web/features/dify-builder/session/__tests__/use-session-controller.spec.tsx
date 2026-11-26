import type { ConversationItem } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { queryClientAtom } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/console'
import {
  builderDefaultModel,
  builderModel,
  builderModelListQueryKey,
  createBuilderQueryClient,
} from '../../__tests__/model-fixtures'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionErrorCodeAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from '../state'
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

vi.mock('@/service/console', async (importOriginal) => ({
  consoleQuery: (await importOriginal<typeof import('@/service/console')>()).consoleQuery,
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

describe('useDifyBuilderSessionController lifecycle', () => {
  it('keeps a completed conversation pointer and restores durable history', async () => {
    const completed = createSessionView({
      run_status: 'complete',
      canvas_read_only: false,
      conversation_last_seq: 0,
    })
    clientMocks.get.mockResolvedValue(completed)
    clientMocks.conversation.mockResolvedValue(
      conversationPage([
        {
          seq: 0,
          at_version: 1,
          kind: 'user',
          payload: { text: 'Original request', turn_id: 'original-turn' },
        },
      ]),
    )
    const { result, store } = renderSessionHook()
    await act(async () => {
      expect(await result.current.restore('session-1')).toBe(true)
    })
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
    expect(store.get(difyBuilderConversationAtom)[0]?.payload).toMatchObject({
      text: 'Original request',
    })
    expect(clientMocks.create).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.resetAllMocks()
    clientMocks.conversation.mockResolvedValue(conversationPage())
  })

  it('refreshes model availability after a rejected creation and can retry in the same app', async () => {
    clientMocks.create.mockRejectedValueOnce({
      data: {
        status: 400,
        body: { code: 'model_unavailable', message: 'Provider changed', recoverable: true },
      },
    })
    const { result, store } = renderSessionHook()
    const queryClient = createBuilderQueryClient()
    store.set(queryClientAtom, queryClient)

    await act(async () => {
      expect(
        await result.current.startBuild('app-1', 'Build an expense assistant', builderModel),
      ).toBe(false)
    })

    expect(store.get(difyBuilderSessionErrorCodeAtom)).toBe('model_unavailable')
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderSessionViewAtom)).toBeNull()
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBeNull()
    expect(
      queryClient.getQueryState(
        consoleQuery.workspaces.current.defaultModel.get.queryKey({
          input: { query: { model_type: builderDefaultModel.model_type } },
        }),
      )?.isInvalidated,
    ).toBe(true)
    expect(queryClient.getQueryState(builderModelListQueryKey)?.isInvalidated).toBe(true)
    expect(clientMocks.get).not.toHaveBeenCalled()
    expect(clientMocks.create).toHaveBeenCalledOnce()

    const waiting = createSessionView({ run_status: 'waiting_input', canvas_read_only: false })
    clientMocks.create.mockResolvedValueOnce(
      streamOf(commandStartedEvent(waiting), stateEvent(waiting)),
    )
    await act(async () => {
      expect(
        await result.current.startBuild('app-1', 'Build an expense assistant', builderModel),
      ).toBe(true)
    })
    expect(store.get(difyBuilderSessionErrorCodeAtom)).toBeNull()
    expect(store.get(difyBuilderSessionViewAtom)?.session_id).toBe('session-1')
    expect(clientMocks.create).toHaveBeenCalledTimes(2)
  })

  it('accepts a terminal error when GET confirms the same command durably advanced', async () => {
    const waiting = createSessionView({
      version: 2,
      run_status: 'waiting_input',
    })
    const latest = createSessionView({
      ...waiting,
      version: 3,
      last_command_id: 'command-1',
    })
    clientMocks.action.mockResolvedValue(
      streamOf(commandStartedEvent(waiting), {
        event: 'error',
        data: {
          code: 'command_finished_unavailable',
          message: 'step failed',
          session_id: waiting.session_id,
          command_id: 'command-1',
        },
      }),
    )
    clientMocks.get.mockResolvedValue(latest)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    await act(async () => {
      expect(await result.current.runAction('approve_plan')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(latest)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })

  it('rejects an unexpected command EOF when reconciliation shows no advance', async () => {
    const started = createSessionView()
    const unchanged = createSessionView({
      run_status: 'waiting_input',
    })
    clientMocks.create.mockResolvedValue(streamOf(commandStartedEvent(started)))
    clientMocks.get.mockResolvedValue(unchanged)
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.startBuild('app-1', 'Build a support workflow')).toBe(false)
    })

    expect(store.get(difyBuilderSessionViewAtom)).toEqual(unchanged)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toContain('terminal event')
  })

  it('does not treat another command version as success after an existing action EOF', async () => {
    const waiting = createSessionView({
      version: 2,
      run_status: 'waiting_input',
    })
    const advancedByAnotherCommand = createSessionView({
      ...waiting,
      version: 3,
      last_command_id: 'another-command',
    })
    clientMocks.action.mockResolvedValue(streamOf(commandStartedEvent(waiting)))
    clientMocks.get.mockResolvedValue(advancedByAnotherCommand)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderSessionViewAtom, waiting)
      store.set(difyBuilderActiveSessionIdAtom, waiting.session_id)
    })

    await act(async () => {
      expect(await result.current.runAction('approve_plan')).toBe(false)
    })

    expect(store.get(difyBuilderSessionViewAtom)).toEqual(advancedByAnotherCommand)
    expect(store.get(difyBuilderSessionLastErrorAtom)).toContain('terminal event')
  })

  it('keeps a thinking restore stream open until the authoritative state arrives', async () => {
    const thinking = createSessionView({
      session_id: 'session-restored',
      run_status: 'processing',
      version: 3,
    })
    const terminal = createSessionView({
      ...thinking,
      version: 4,
      run_status: 'waiting_confirmation',
    })
    clientMocks.get.mockResolvedValue(thinking)
    clientMocks.stream.mockResolvedValue(streamOf(stateEvent(terminal)))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(terminal)
  })

  it('retries a restore when an active GET stream ends before a state frame', async () => {
    const executing = createSessionView({
      session_id: 'session-restored',
      run_status: 'processing',
      version: 3,
    })
    const waiting = createSessionView({
      ...executing,
      version: 4,
      run_status: 'waiting_input',
    })
    clientMocks.get.mockResolvedValueOnce(executing).mockResolvedValueOnce(waiting)
    clientMocks.stream.mockResolvedValueOnce(streamOf())
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledTimes(2)
    expect(clientMocks.stream).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(waiting)
  })

  it('restores an interrupted working state through the session snapshot', async () => {
    const interrupted = createSessionView({
      actions: [{ id: 'restart', label: 'Restart from current draft', kind: 'primary' }],
      interrupted: true,
      session_id: 'session-restored',
      run_status: 'processing',
      version: 3,
    })
    clientMocks.get.mockResolvedValue(interrupted)
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-restored')).toBe(true)
    })

    expect(clientMocks.get).toHaveBeenCalledOnce()
    expect(clientMocks.stream).not.toHaveBeenCalled()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(interrupted)
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-restored')
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
  })

  it('restores the latest history page and prepends an older complete group', async () => {
    const olderGroup: ConversationItem[] = [
      {
        seq: 0,
        at_version: 1,
        kind: 'form' as const,
        payload: { variant: 'testdata' as const, fields: [], values: {} },
      },
      {
        seq: 1,
        at_version: 1,
        kind: 'assistant_turn' as const,
        payload: {
          turn_id: 'turn-1',
          stage_id: 'build.await_testdata',
          execution: { status: 'completed' },
          reply_text: 'Provide test data.',
          cards: ['form'],
        },
      },
    ]
    const latestItem = {
      seq: 2,
      at_version: 2,
      kind: 'notice' as const,
      payload: { text: 'Waiting for input' },
    }
    const view = createSessionView({
      conversation_last_seq: 2,
      run_status: 'waiting_input',
    })
    clientMocks.get.mockResolvedValue(view)
    clientMocks.conversation
      .mockResolvedValueOnce(conversationPage([latestItem], true))
      .mockResolvedValueOnce(conversationPage(olderGroup))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-1')).toBe(true)
    })
    expect(store.get(difyBuilderConversationAtom)).toEqual([latestItem])
    expect(store.get(difyBuilderConversationHasMoreAtom)).toBe(true)

    await act(async () => {
      expect(await result.current.loadOlderConversation()).toBe(true)
    })

    expect(clientMocks.conversation).toHaveBeenLastCalledWith(
      {
        params: { session_id: 'session-1' },
        query: { before_seq: 2, limit: 20 },
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0, 1, 2])
    expect(store.get(difyBuilderConversationHasMoreAtom)).toBe(false)
  })

  it('bounds restored history to the session snapshot sequence', async () => {
    const snapshotItem = {
      seq: 2,
      at_version: 2,
      kind: 'notice' as const,
      payload: { text: 'Snapshot item' },
    }
    const futureItem = {
      seq: 3,
      at_version: 3,
      kind: 'notice' as const,
      payload: { text: 'Future item' },
    }
    const view = createSessionView({
      conversation_last_seq: 2,
      run_status: 'waiting_input',
      version: 2,
    })
    clientMocks.get.mockResolvedValue(view)
    clientMocks.conversation.mockResolvedValue(conversationPage([snapshotItem, futureItem]))
    const { result, store } = renderSessionHook()

    await act(async () => {
      expect(await result.current.restore('session-1')).toBe(true)
    })

    expect(clientMocks.conversation).toHaveBeenCalledWith(
      {
        params: { session_id: 'session-1' },
        query: { before_seq: 3, limit: 20 },
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(store.get(difyBuilderConversationAtom)).toEqual([snapshotItem])
  })

  it('does not restore an obsolete error after reset while its response body is being read', async () => {
    let resolveBody!: (value: unknown) => void
    const body = new Promise((resolve) => {
      resolveBody = resolve
    })
    const response = new Response(null, { status: 409 })
    const clone = new Response(null, { status: 409 })
    vi.spyOn(clone, 'json').mockReturnValue(body)
    const cloneSpy = vi.spyOn(response, 'clone').mockReturnValue(clone)
    clientMocks.create.mockRejectedValue(response)
    const { result, store } = renderSessionHook()
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.startBuild('app-1', 'Build a workflow')
    })
    await waitFor(() => expect(cloneSpy).toHaveBeenCalled())
    act(() => result.current.reset())
    await act(async () => {
      resolveBody({ code: 'conflict' })
      expect(await pending).toBe(false)
    })
    expect(store.get(difyBuilderSessionLastErrorAtom)).toBe('')
    expect(store.get(difyBuilderSessionViewAtom)).toBeNull()
  })
})
