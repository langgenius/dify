import type { ComponentProps } from 'react'
import type { ChatItem } from '../../../types'
import type { ChatContextValue } from '../../context'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import {
  createChatThoughtFixture,
  createChatConfigFixture as makeChatConfig,
} from '@/test/fixtures/chat'
import { ChatContextProvider } from '../../context-provider'
import Operation from '../operation'

const {
  mockAddAnnotation,
  mockEditAnnotation,
  mockRemoveAnnotation,
  mockGetAudioPlayer,
  mockPlayAudio,
} = vi.hoisted(() => {
  return {
    mockAddAnnotation:
      vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.annotations.post>(),
    mockEditAnnotation:
      vi.fn<
        typeof import('@/service/console').consoleClient.apps.byAppId.annotations.byAnnotationId.post
      >(),
    mockRemoveAnnotation:
      vi.fn<
        typeof import('@/service/console').consoleClient.apps.byAppId.annotations.byAnnotationId.delete
      >(),
    mockGetAudioPlayer: vi.fn(),
    mockPlayAudio: vi.fn(),
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.byAnnotationId.post': (input) => mockEditAnnotation(input),
      'apps.byAppId.annotations.byAnnotationId.delete': (input) => mockRemoveAnnotation(input),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.annotations.post': mockAddAnnotation,
      'apps.byAppId.annotations.byAnnotationId.post': mockEditAnnotation,
    }),
  }
})

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: { getInstance: () => ({ getAudioPlayer: mockGetAudioPlayer }) },
}))

vi.mock('@/next/navigation', () => ({
  useParams: vi.fn(() => ({ appId: 'test-app' })),
  usePathname: vi.fn(() => '/apps/test-app'),
}))

const mockContextValue: ChatContextValue = {
  chatList: [],
  config: makeChatConfig({ supportFeedback: true }),
  onFeedback: vi.fn().mockResolvedValue(undefined),
  onRegenerate: vi.fn(),
  showRegenerate: false,
  onAnnotationAdded: vi.fn(),
  onAnnotationEdited: vi.fn(),
  onAnnotationRemoved: vi.fn(),
  readonly: false,
}

type OperationProps = ComponentProps<typeof Operation>

const baseItem: ChatItem = {
  id: 'msg-1',
  content: 'Hello world',
  isAnswer: true,
}

const createInterruptedItem = (messages: string[]): ChatItem => {
  const thought = createChatThoughtFixture({ thought: 'internal thought should not be used' })

  return {
    ...baseItem,
    content: '',
    agent_response_parts: [
      { type: 'thought', thought },
      ...messages.map((content) => ({ type: 'message' as const, content })),
    ],
    agent_thoughts: [thought],
  }
}

const baseProps: OperationProps = {
  item: baseItem,
  question: 'What is this?',
  index: 0,
  maxSize: 500,
  contentWidth: 300,
  hasWorkflowProcess: false,
}

afterEach(() => toast.dismiss())

describe('Operation', () => {
  const renderOperation = (props = baseProps) => {
    const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
    return render(
      <div className="group">
        <Operation {...props} />
      </div>,
      {
        wrapper: ({ children }) => (
          <QueryWrapper>
            <ChatContextProvider {...mockContextValue}>{children}</ChatContextProvider>
            <AppToaster timeout={0} />
          </QueryWrapper>
        ),
      },
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockContextValue.config = makeChatConfig({ supportFeedback: true })
    mockContextValue.onFeedback = vi.fn().mockResolvedValue(undefined)
    mockContextValue.onRegenerate = vi.fn()
    mockContextValue.onAnnotationAdded = vi.fn()
    mockContextValue.onAnnotationEdited = vi.fn()
    mockContextValue.onAnnotationRemoved = vi.fn()
    mockContextValue.readonly = false
    mockContextValue.showRegenerate = false
    mockContextValue.onOpenLog = undefined

    mockAddAnnotation.mockReset().mockResolvedValue({ id: 'ann-new' })
    mockRemoveAnnotation.mockReset().mockResolvedValue(undefined)
    mockEditAnnotation.mockReset().mockResolvedValue({ id: 'ann-1' })
    mockGetAudioPlayer
      .mockReset()
      .mockReturnValue({ playAudio: mockPlayAudio, pauseAudio: vi.fn() })
  })

  describe('feedback submission sessions', () => {
    it.each([{ admin: false }, { admin: true }])(
      'preserves the draft after a failed submission and retries successfully (admin: $admin)',
      async ({ admin }) => {
        mockContextValue.config = makeChatConfig({
          supportFeedback: true,
          supportAnnotation: admin,
        })
        const onFeedback = vi.fn<NonNullable<ChatContextValue['onFeedback']>>()
        onFeedback.mockRejectedValueOnce(new Error('Feedback failed')).mockResolvedValueOnce()
        mockContextValue.onFeedback = onFeedback
        const user = userEvent.setup()
        renderOperation()
        const name = `${admin ? 'appLog.table.header.adminRate' : 'appLog.table.header.userRate'}: appLog.detail.operation.dislike`
        await user.click(screen.getByRole('button', { name }))
        const input = screen.getByRole('textbox', { name: 'common.feedback.content' })
        await user.type(input, 'Needs more detail')
        await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))
        await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(input).toHaveValue('Needs more detail')
        await user.type(input, ' please')
        await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(onFeedback).toHaveBeenLastCalledWith('msg-1', {
          rating: 'dislike',
          content: 'Needs more detail please',
        })
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
      },
    )

    it('keeps one pending submission open and prevents edits or duplicate submissions', async () => {
      const pending = createDeferred<void>()
      const onFeedback = vi.fn().mockReturnValue(pending.promise)
      mockContextValue.onFeedback = onFeedback
      const user = userEvent.setup()
      renderOperation()
      await user.click(
        screen.getByRole('button', {
          name: 'appLog.table.header.userRate: appLog.detail.operation.dislike',
        }),
      )
      const input = screen.getByRole('textbox', { name: 'common.feedback.content' })
      await user.type(input, 'Original draft')
      const submit = screen.getByRole('button', { name: 'common.operation.submit' })
      await user.click(submit)
      expect(submit).toHaveAttribute('aria-disabled', 'true')
      expect(input).toHaveAttribute('readonly')
      await user.keyboard('{Escape}')
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
      await user.click(document.body)
      await user.click(submit)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(onFeedback).toHaveBeenCalledTimes(1)
      await act(async () => {
        pending.resolve()
        await pending.promise
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  it.each([
    { name: 'normal answer', item: baseItem, expected: 'Hello world' },
    {
      name: 'interrupted public parts',
      item: createInterruptedItem(['First update', 'Second update']),
      expected: 'First update\n\nSecond update',
    },
    {
      name: 'answer before internal thoughts',
      item: { ...createInterruptedItem([]), content: 'Final answer' },
      expected: 'Final answer',
    },
    {
      name: 'legacy public thought answer',
      item: {
        ...createInterruptedItem([]),
        agent_thoughts: [createChatThoughtFixture({ answer: 'Public legacy answer' })],
      },
      expected: 'Public legacy answer',
    },
  ])('copies $name without exposing internal reasoning', async ({ item, expected }) => {
    const user = userEvent.setup()
    renderOperation({ ...baseProps, item })
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(await navigator.clipboard.readText()).toBe(expected)
    expect(screen.getByRole('button', { name: 'common.operation.copied' })).toBeInTheDocument()
  })

  it('routes regenerate and log actions to their answer', async () => {
    const user = userEvent.setup()
    mockContextValue.onOpenLog = vi.fn()
    renderOperation()
    await user.click(screen.getByRole('button', { name: 'common.operation.regenerate' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.log' }))
    expect(mockContextValue.onRegenerate).toHaveBeenCalledExactlyOnceWith(baseItem)
    expect(mockContextValue.onOpenLog).toHaveBeenCalledExactlyOnceWith(baseItem)
  })

  it('allows regeneration without a chat input only when the owner explicitly enables it', () => {
    const view = renderOperation({ ...baseProps, noChatInput: true })
    expect(
      screen.queryByRole('button', { name: 'common.operation.regenerate' }),
    ).not.toBeInTheDocument()
    mockContextValue.showRegenerate = true
    view.rerender(<Operation {...baseProps} noChatInput />)
    expect(screen.getByRole('button', { name: 'common.operation.regenerate' })).toBeInTheDocument()
  })

  it('offers no operations on opening statements', () => {
    mockContextValue.onOpenLog = vi.fn()
    renderOperation({ ...baseProps, item: { ...baseItem, isOpeningStatement: true } })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  const annotationConfig = {
    supportAnnotation: true,
    appId: 'test-app',
    annotation_reply: {
      id: 'ar-1',
      score_threshold: 0.5,
      enabled: true,
      embedding_model: { embedding_provider_name: '', embedding_model_name: '' },
    },
  }

  it.each([
    { name: 'no public answer', item: createInterruptedItem([]) },
    {
      name: 'waiting for human input',
      item: {
        ...baseItem,
        humanInputFormDataList: [
          {
            form_id: 'form-1',
            node_id: 'human',
            node_title: 'Review',
            form_token: 'form-1',
            form_content: 'Please review',
            inputs: [],
            actions: [],
            resolved_default_values: {},
            display_in_ui: true,
            expiration_time: null,
          },
        ],
      } satisfies ChatItem,
    },
  ])('hides content actions with $name', ({ item }) => {
    mockContextValue.config = makeChatConfig({
      ...annotationConfig,
      text_to_speech: { enabled: true },
    })
    renderOperation({ ...baseProps, item })
    expect(screen.queryByRole('button', { name: 'common.operation.copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'appApi.play' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'appDebug.feature.annotation.add' }),
    ).not.toBeInTheDocument()
  })

  it.each([false, true])('submits and removes local feedback (admin: %s)', async (admin) => {
    const user = userEvent.setup()
    mockContextValue.config = makeChatConfig({ supportFeedback: true, supportAnnotation: admin })
    renderOperation()
    const prefix = `appLog.table.header.${admin ? 'adminRate' : 'userRate'}: appLog.detail.operation.`
    await user.click(screen.getByRole('button', { name: `${prefix}like` }))
    expect(screen.getByRole('button', { name: `${prefix}like`, pressed: true })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `${prefix}like` }))
    expect(
      screen.getByRole('button', { name: `${prefix}like`, pressed: false }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `${prefix}dislike` }))
    await user.type(
      screen.getByRole('textbox', { name: 'common.feedback.content' }),
      'Needs examples',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: `${prefix}dislike`, pressed: true }))
    expect(vi.mocked(mockContextValue.onFeedback!).mock.calls).toEqual([
      ['msg-1', { rating: 'like', content: undefined }],
      ['msg-1', { rating: null, content: undefined }],
      ['msg-1', { rating: 'dislike', content: 'Needs examples' }],
      ['msg-1', { rating: null, content: undefined }],
    ])
  })

  it('shows refreshed user feedback as status and keeps admin feedback actionable', () => {
    mockContextValue.config = makeChatConfig({ supportFeedback: true, supportAnnotation: true })
    const view = renderOperation()
    view.rerender(
      <Operation
        {...baseProps}
        item={{
          ...baseItem,
          feedback: { rating: 'dislike', content: 'Needs work' },
          adminFeedback: { rating: 'like' },
        }}
      />,
    )
    expect(
      screen.getByRole('img', {
        name: 'appLog.table.header.userRate: appLog.detail.operation.dislike - Needs work',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'appLog.table.header.userRate: appLog.detail.operation.dislike',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'appLog.table.header.adminRate: appLog.detail.operation.like',
        pressed: true,
      }),
    ).toBeInTheDocument()
  })

  it('does not offer feedback when its owner has no submission callback', () => {
    mockContextValue.onFeedback = undefined
    renderOperation()
    expect(
      screen.queryByRole('button', { name: /appLog.detail.operation.(like|dislike)/ }),
    ).not.toBeInTheDocument()
  })

  it('creates an annotation from public response content and reports its server ID', async () => {
    const user = userEvent.setup()
    mockContextValue.config = makeChatConfig(annotationConfig)
    renderOperation({ ...baseProps, item: createInterruptedItem(['Public interrupted answer']) })
    await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.add' }))
    expect(await screen.findByText('common.api.actionSuccess')).toBeInTheDocument()
    expect(mockAddAnnotation).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'test-app' },
      body: { message_id: 'msg-1', question: 'What is this?', answer: 'Public interrupted answer' },
    })
    expect(mockContextValue.onAnnotationAdded).toHaveBeenCalledExactlyOnceWith(
      'ann-new',
      '',
      'What is this?',
      'Public interrupted answer',
      0,
    )
  })

  const annotatedItem = { ...baseItem, annotation: { id: 'ann-1', authorName: 'Author' } }

  it('edits an annotation through the real dialog and forwards the saved answer', async () => {
    const user = userEvent.setup()
    mockContextValue.config = makeChatConfig(annotationConfig)
    renderOperation({ ...baseProps, item: annotatedItem })
    await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.edit' }))
    const drawer = await screen.findByRole('dialog', { name: 'appAnnotation.editModal.title' })
    await user.click(within(drawer).getAllByRole('button', { name: 'common.operation.edit' })[1]!)
    await user.clear(
      within(drawer).getByRole('textbox', { name: 'appAnnotation.editModal.yourAnswer' }),
    )
    await user.type(
      within(drawer).getByRole('textbox', { name: 'appAnnotation.editModal.yourAnswer' }),
      'Corrected answer',
    )
    await user.click(within(drawer).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(within(drawer).queryByRole('textbox')).not.toBeInTheDocument())
    expect(mockEditAnnotation).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'test-app', annotation_id: 'ann-1' },
      body: { question: 'What is this?', answer: 'Corrected answer' },
    })
    expect(mockContextValue.onAnnotationEdited).toHaveBeenCalledExactlyOnceWith(
      'What is this?',
      'Corrected answer',
      0,
    )
    await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'appAnnotation.editModal.title' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('only removes an annotation after confirmation', async () => {
    const user = userEvent.setup()
    mockContextValue.config = makeChatConfig(annotationConfig)
    renderOperation({ ...baseProps, item: annotatedItem })
    await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.edit' }))
    const remove = await screen.findByRole('button', {
      name: 'appAnnotation.editModal.removeThisCache',
    })
    await user.click(remove)
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(mockContextValue.onAnnotationRemoved).not.toHaveBeenCalled()
    await user.click(remove)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() =>
      expect(mockContextValue.onAnnotationRemoved).toHaveBeenCalledExactlyOnceWith(0),
    )
    expect(mockRemoveAnnotation).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'test-app', annotation_id: 'ann-1' },
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each(['readonly', 'missing callbacks'] as const)(
    'hides annotation mutation actions with %s',
    (condition) => {
      mockContextValue.config = makeChatConfig(annotationConfig)
      if (condition === 'readonly') mockContextValue.readonly = true
      else mockContextValue.onAnnotationRemoved = undefined
      renderOperation({ ...baseProps, item: annotatedItem })
      expect(
        screen.queryByRole('button', { name: /appDebug.feature.annotation.(add|edit)/ }),
      ).not.toBeInTheDocument()
    },
  )

  it('plays public response content through the audio service', async () => {
    const user = userEvent.setup()
    mockContextValue.config = makeChatConfig({
      text_to_speech: { enabled: true, voice: 'test-voice' },
    })
    renderOperation({ ...baseProps, item: createInterruptedItem(['Public interrupted answer']) })
    await user.click(screen.getByRole('button', { name: 'appApi.play' }))
    expect(mockGetAudioPlayer).toHaveBeenCalledExactlyOnceWith(
      '/apps/test-app/text-to-audio',
      false,
      'msg-1',
      'Public interrupted answer',
      'test-voice',
      expect.any(Function),
    )
    expect(mockPlayAudio).toHaveBeenCalledTimes(1)
  })
})
