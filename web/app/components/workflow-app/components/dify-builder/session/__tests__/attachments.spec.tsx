import { act, waitFor } from '@testing-library/react'
import { createBuildSession, createEditSession, sendSessionMessage } from '../client'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderMaterialControlAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import {
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  renderSessionHook,
  stateEvent,
} from './fixtures'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  message: vi.fn(),
  get: vi.fn(),
  conversation: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => ({
  consoleQuery: (await importOriginal<typeof import('@/service/console')>()).consoleQuery,
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: api.create,
        bySessionId: {
          get: api.get,
          conversation: { get: api.conversation },
          messages: { post: api.message },
        },
      },
    },
  },
}))

beforeEach(() => vi.resetAllMocks())

it('passes authorized upload references in create/message bodies without binding test inputs', async () => {
  const attachments = [{ upload_file_id: 'upload-1' }]
  const signal = new AbortController().signal
  await createBuildSession('app-1', '', undefined, signal, false, attachments)
  expect(api.create.mock.calls[0]![0].body).toEqual({
    app_id: 'app-1',
    scenario: 'build',
    goal_text: '',
    derive_app_name: false,
    attachments,
  })
  await createEditSession('app-1', 'Use the attached rules', undefined, signal, attachments)
  expect(api.create.mock.calls[1]![0].body).toEqual({
    app_id: 'app-1',
    scenario: 'edit',
    goal_text: 'Use the attached rules',
    attachments,
  })
  await sendSessionMessage('session-1', 'More context', 4, 'turn-2', signal, attachments)
  expect(api.message.mock.calls[0]![0].body).toEqual({
    text: 'More context',
    base_version: 4,
    client_turn_id: 'turn-2',
    attachments,
  })
})

it('queues material while the original response is busy without saving or interrupting it', async () => {
  const response = createControlledEventStream()
  api.create.mockResolvedValue(response.iterable)
  const prepare = vi.fn(async () => {})
  const { result, store } = renderSessionHook(prepare)
  let building!: Promise<boolean>
  act(() => {
    building = result.current.startBuild('app-1', 'Original goal')
  })
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  act(() => response.push(commandStartedEvent(createSessionView({ version: 4 }))))
  await waitFor(() => expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1'))
  const queued = createSessionView({
    version: 4,
    attachments: [
      {
        id: 'material-1',
        app_id: 'app-1',
        session_id: 'session-1',
        task_id: 'task-1',
        generation: 1,
        seq: 0,
        client_turn_id: 'material-turn',
        consumed_version: null,
        status: 'pending',
        test_input_candidate: true,
        attachments: [
          {
            upload_file_id: 'upload-1',
            name: 'rules.txt',
            extension: 'txt',
            size: 20,
            status: 'pending',
          },
        ],
      },
    ],
  })
  api.message.mockImplementation(async ({ body }) =>
    (async function* () {
      yield {
        event: 'command_started' as const,
        data: {
          session_id: 'session-1',
          version: 4,
          phase: 'understand' as const,
          run_status: 'processing' as const,
          command_id: '',
        },
      }
      yield stateEvent(
        {
          ...queued,
          attachments: queued.attachments!.map((receipt) => ({
            ...receipt,
            client_turn_id: body.client_turn_id,
          })),
        },
        { command_id: '' },
      )
    })(),
  )
  await act(async () =>
    expect(
      await result.current.sendMessage('Use these rules', undefined, [
        { upload_file_id: 'upload-1' },
      ]),
    ).toBe(true),
  )
  expect(api.message).toHaveBeenCalledOnce()
  expect(api.create.mock.calls[0]![1].signal.aborted).toBe(false)
  expect(prepare).toHaveBeenCalledOnce()
  expect(store.get(difyBuilderSessionViewAtom)?.attachments?.[0]?.status).toBe('pending')
  await act(async () => {
    response.push(stateEvent(createSessionView({ version: 5, run_status: 'waiting_input' })))
    await building
  })
})

it.each([
  { status: 409, expected: null },
  { status: undefined, expected: 'unknown' },
])(
  'keeps a $status material rejection separate from the original session and never retries uncertain delivery',
  async ({ status, expected }) => {
    const { result, store } = renderSessionHook()
    const view = createSessionView({ version: 4 })
    store.set(difyBuilderSessionViewAtom, view)
    api.message.mockRejectedValue(
      Object.assign(new Error('Delivery failed'), status ? { status } : {}),
    )
    const attachments = [{ upload_file_id: 'upload-1' }]
    await act(async () =>
      expect(await result.current.sendMessage('Rules', undefined, attachments)).toBe(false),
    )
    expect(store.get(difyBuilderMaterialControlAtom)?.phase ?? null).toBe(expected)
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(view)
    expect(api.message).toHaveBeenCalledOnce()
    if (expected === 'unknown') {
      await act(async () =>
        expect(await result.current.sendMessage('Rules', undefined, attachments)).toBe(false),
      )
      expect(api.message).toHaveBeenCalledOnce()
    }
  },
)

it('consumes an actual material command without the draft-save barrier and resolves unknown delivery using GET only', async () => {
  const prepare = vi.fn(async () => {})
  const { result, store } = renderSessionHook(prepare)
  act(() => store.set(difyBuilderSessionViewAtom, createSessionView({ version: 4 })))
  const attachments = [{ upload_file_id: 'upload-1' }]
  const materialView = (clientTurnId: string) =>
    createSessionView({
      version: 5,
      run_status: 'waiting_input',
      attachments: [
        {
          id: 'material-1',
          app_id: 'app-1',
          session_id: 'session-1',
          task_id: 'task-1',
          generation: 1,
          seq: 1,
          client_turn_id: clientTurnId,
          consumed_version: 5,
          status: 'consumed',
          test_input_candidate: false,
          attachments: [
            {
              upload_file_id: 'upload-1',
              name: 'rules.txt',
              extension: 'txt',
              size: 20,
              status: 'consumed',
            },
          ],
        },
      ],
    })
  api.message.mockImplementationOnce(async ({ body }) =>
    (async function* () {
      yield commandStartedEvent(createSessionView({ version: 4 }))
      yield stateEvent(materialView(body.client_turn_id))
    })(),
  )
  await act(async () =>
    expect(await result.current.sendMessage('', undefined, attachments)).toBe(true),
  )
  expect(prepare).not.toHaveBeenCalled()
  expect(store.get(difyBuilderSessionViewAtom)?.attachments?.[0]?.status).toBe('consumed')
  act(() => store.set(difyBuilderMaterialControlAtom, null))
  api.message.mockRejectedValueOnce(new TypeError('Network lost'))
  await act(async () =>
    expect(await result.current.sendMessage('More context', undefined, attachments)).toBe(false),
  )
  const uncertain = store.get(difyBuilderMaterialControlAtom)!
  expect(uncertain.phase).toBe('unknown')
  api.get.mockResolvedValueOnce(materialView(uncertain.clientTurnId))
  api.conversation.mockResolvedValueOnce(conversationPage())
  await act(async () => expect(await result.current.refresh()).toBe(true))
  expect(api.get).toHaveBeenCalledOnce()
  expect(api.message).toHaveBeenCalledTimes(2)
  expect(store.get(difyBuilderMaterialControlAtom)?.phase).toBe('accepted')
})
