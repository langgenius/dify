import { act, render, screen } from '@testing-library/react'
import { Provider } from 'jotai'
import { Suspense } from 'react'
import { getI18n } from 'react-i18next'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import englishBuilder from '@/i18n/locales/en-US/dify-builder.json'
import chineseBuilder from '@/i18n/locales/zh-Hans/dify-builder.json'
import { StreamingAssistantTurn } from '../../conversation/streaming-assistant-turn'
import { DifyBuilderLocaleProvider } from '../../interactions/locale-provider'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderReplyLanguageAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import {
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  progressEvent,
  renderSessionHook,
  stateEvent,
  streamOf,
} from './fixtures'

vi.unmock('react-i18next')

const client = vi.hoisted(() => ({
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
        bySessionId: {
          get: client.get,
          conversation: { get: client.conversation },
          stream: { get: client.stream },
          actions: { post: client.action },
          messages: { post: client.message },
        },
      },
    },
  },
}))

describe('Builder reply language lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    client.conversation.mockResolvedValue(conversationPage())
  })

  it('restores reply language from the session GET without starting another command', async () => {
    const view = createSessionView({ run_status: 'waiting_input', reply_language: 'zh-Hans' })
    client.get.mockResolvedValue(view)
    const { result, store } = renderSessionHook()
    await act(async () => {
      expect(await result.current.restore(view.session_id)).toBe(true)
    })
    expect(store.get(difyBuilderReplyLanguageAtom)).toBe('zh-Hans')
    expect(client.stream).not.toHaveBeenCalled()
    expect(client.action).not.toHaveBeenCalled()
    expect(client.message).not.toHaveBeenCalled()
  })

  it.each(['action', 'message'] as const)(
    'updates reply language from the %s terminal event without changing the request',
    async (kind) => {
      const initial = createSessionView({ run_status: 'waiting_input', reply_language: 'en' })
      const next = createSessionView({ ...initial, version: 2, reply_language: 'zh-Hans' })
      client[kind].mockResolvedValue(streamOf(commandStartedEvent(initial), stateEvent(next)))
      const { result, store } = renderSessionHook()
      store.set(difyBuilderSessionViewAtom, initial)
      store.set(difyBuilderActiveSessionIdAtom, initial.session_id)
      await act(async () => {
        expect(
          await (kind === 'action'
            ? result.current.runAction('confirm', { option_id: 'approve_plan', free_text: 'Yes' })
            : result.current.sendMessage('Goal', 'turn-goal')),
        ).toBe(true)
      })
      expect(store.get(difyBuilderReplyLanguageAtom)).toBe('zh-Hans')
      expect(client[kind]).toHaveBeenCalledExactlyOnceWith(
        {
          params: { session_id: initial.session_id },
          body:
            kind === 'action'
              ? {
                  action_id: 'confirm',
                  payload: { option_id: 'approve_plan', free_text: 'Yes' },
                  base_version: 1,
                  base_app_revision: 'revision-1',
                }
              : { text: 'Goal', client_turn_id: 'turn-goal', base_version: 1 },
        },
        { signal: expect.any(AbortSignal) },
      )
      expect(client.get).not.toHaveBeenCalled()
    },
  )

  it('restores the latest reply language from reconnect SSE', async () => {
    const initial = createSessionView({ reply_language: 'en' })
    const next = createSessionView({
      ...initial,
      version: 2,
      run_status: 'waiting_input',
      reply_language: 'ja',
    })
    client.get.mockResolvedValue(initial)
    client.stream.mockResolvedValue(streamOf(stateEvent(next)))
    const { result, store } = renderSessionHook()
    await act(async () => {
      expect(await result.current.restore(initial.session_id)).toBe(true)
    })
    expect(client.stream).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderReplyLanguageAtom)).toBe('ja')
    expect(client.action).not.toHaveBeenCalled()
    expect(client.message).not.toHaveBeenCalled()
  })

  it('renders the detected language from the first progress before the terminal projection', async () => {
    const initial = createSessionView({ run_status: 'waiting_input', reply_language: 'en' })
    const stream = createControlledEventStream()
    client.action.mockResolvedValue(stream.iterable)
    const { result, store } = renderSessionHook()
    store.set(difyBuilderSessionViewAtom, initial)
    store.set(difyBuilderActiveSessionIdAtom, initial.session_id)
    render(
      <I18nClientProvider locale="en-US" resource={{}}>
        <Provider store={store}>
          <Suspense fallback={<p>Loading translations</p>}>
            <DifyBuilderLocaleProvider>
              <StreamingAssistantTurn busy />
            </DifyBuilderLocaleProvider>
          </Suspense>
        </Provider>
      </I18nClientProvider>,
    )

    let command: Promise<boolean>
    act(() => {
      command = result.current.runAction('submit_requirements', { text: 'Goal / {{name}} / <tag>' })
    })
    await act(async () => {
      stream.push(commandStartedEvent(initial))
      stream.push(
        progressEvent({
          reply_language: 'zh-Hans',
          activity: {
            id: 'build-understand-goal',
            label: { type: 'copy', id: 'progress.understandTheRequestedWorkflow' },
            state: 'active',
          },
        }),
      )
    })

    expect(
      await screen.findByText(chineseBuilder['copy.progress.understandTheRequestedWorkflow']),
    ).toBeVisible()
    expect(
      screen.queryByText(englishBuilder['copy.progress.understandTheRequestedWorkflow']),
    ).not.toBeInTheDocument()
    expect(store.get(difyBuilderSessionViewAtom)?.reply_language).toBe('en')
    expect(getI18n()?.language).toBe('en-US')

    await act(async () => {
      stream.push(stateEvent({ ...initial, version: 2, reply_language: 'zh-Hans' }))
      stream.close()
      expect(await command).toBe(true)
    })
    expect(store.get(difyBuilderReplyLanguageAtom)).toBe('zh-Hans')
  })

  it('does not replace the current reply language with a stale terminal projection', async () => {
    const current = createSessionView({
      version: 3,
      reply_language: 'fr',
      run_status: 'waiting_input',
    })
    const stale = createSessionView({ ...current, version: 2, reply_language: 'en' })
    client.action.mockResolvedValue(streamOf(commandStartedEvent(current), stateEvent(stale)))
    const { result, store } = renderSessionHook()
    store.set(difyBuilderSessionViewAtom, current)
    store.set(difyBuilderActiveSessionIdAtom, current.session_id)
    await act(async () => {
      expect(await result.current.runAction('confirm', { option_id: 'approve_plan' })).toBe(false)
    })
    expect(store.get(difyBuilderReplyLanguageAtom)).toBe('fr')
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(current)
  })
})
