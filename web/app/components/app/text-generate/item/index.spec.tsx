import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import type { IGenerationItemProps } from './index'
import GenerationItem from './index'

jest.mock('react-i18next', () => {
  const translate = (key: string) => {
    const map: Record<string, string> = {
      'appDebug.errorMessage.waitForResponse': 'please-wait',
      'common.actionMsg.copySuccessfully': 'copied',
      'runLog.result': 'Result',
      'runLog.detail': 'Detail',
      'share.generation.execution': 'Execution',
      'share.generation.batchFailed.outputPlaceholder': 'failed',
      'common.unit.char': 'chars',
    }
    return map[key] ?? key
  }
  return {
    useTranslation: () => ({
      t: translate,
    }),
  }
})

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}))

jest.mock('@/app/components/base/chat/chat/context', () => ({
  useChatContext: () => ({
    config: { text_to_speech: { voice: 'en-test' } },
  }),
}))

jest.mock('@/app/components/app/store', () => {
  const store = {
    setCurrentLogItem: jest.fn(),
    setShowPromptLogModal: jest.fn(),
  }
  const useStore = (selector?: (state: typeof store) => unknown) => (selector ? selector(store) : store)
  return {
    __esModule: true,
    useStore,
    __store: store,
  }
})

jest.mock('@/app/components/base/toast', () => {
  const notify = jest.fn()
  return {
    __esModule: true,
    default: { notify },
    __notify: notify,
  }
})

jest.mock('copy-to-clipboard', () => ({
  __esModule: true,
  default: jest.fn(),
}))

jest.mock('@/service/share', () => {
  const fetchMoreLikeThis = jest.fn()
  const updateFeedback = jest.fn()
  return {
    __esModule: true,
    fetchMoreLikeThis,
    updateFeedback,
  }
})

jest.mock('@/service/debug', () => ({
  __esModule: true,
  fetchTextGenerationMessage: jest.fn(),
}))

jest.mock('@/app/components/base/loading', () => ({
  __esModule: true,
  default: () => <div data-testid="loading" />,
}))

jest.mock('./content-section', () => {
  const React = require('react')
  const calls: any[] = []
  const Component = (props: any) => {
    calls.push(props)
    return React.createElement(
      'div',
      { 'data-testid': `content-section-${props.taskId ?? 'none'}` },
      typeof props.content === 'string' ? props.content : 'content',
    )
  }
  return {
    __esModule: true,
    default: Component,
    __calls: calls,
  }
})

jest.mock('./meta-section', () => {
  const React = require('react')
  const calls: any[] = []
  const Component = (props: any) => {
    calls.push(props)
    return React.createElement(
      'div',
      { 'data-testid': `meta-section-${props.messageId ?? 'none'}` },
      props.showCharCount && React.createElement('span', { 'data-testid': `char-count-${props.messageId ?? 'none'}` }, props.charCount),
      !props.isInWebApp && !props.isInstalledApp && !props.isResponding && React.createElement(
        'button',
        {
          'data-testid': `open-log-${props.messageId ?? 'none'}`,
          'disabled': !props.messageId || props.isError,
          'onClick': props.onOpenLogModal,
        },
        'open-log',
      ),
      props.moreLikeThis && React.createElement(
        'button',
        {
          'data-testid': `more-like-${props.messageId ?? 'none'}`,
          'disabled': props.disableMoreLikeThis,
          'onClick': props.onMoreLikeThis,
        },
        'more-like',
      ),
      props.canCopy && React.createElement(
        'button',
        {
          'data-testid': `copy-${props.messageId ?? 'none'}`,
          'disabled': !props.messageId || props.isError,
          'onClick': props.onCopy,
        },
        'copy',
      ),
      props.isInWebApp && props.isError && React.createElement(
        'button',
        { 'data-testid': `retry-${props.messageId ?? 'none'}`, 'onClick': props.onRetry },
        'retry',
      ),
      props.isInWebApp && !props.isWorkflow && React.createElement(
        'button',
        {
          'data-testid': `save-${props.messageId ?? 'none'}`,
          'disabled': !props.messageId || props.isError,
          'onClick': () => props.onSave?.(props.messageId as string),
        },
        'save',
      ),
      (props.supportFeedback || props.isInWebApp) && !props.isWorkflow && !props.isError && props.messageId && props.onFeedback && React.createElement(
        'button',
        { 'data-testid': `feedback-${props.messageId}`, 'onClick': () => props.onFeedback?.({ rating: 'like' }) },
        'feedback',
      ),
    )
  }
  return {
    __esModule: true,
    default: Component,
    __calls: calls,
  }
})

const mockUseParams = jest.requireMock('next/navigation').useParams as jest.Mock
const mockStoreModule = jest.requireMock('@/app/components/app/store')
const mockStore = mockStoreModule.__store as { setCurrentLogItem: jest.Mock; setShowPromptLogModal: jest.Mock }
const mockToastNotify = jest.requireMock('@/app/components/base/toast').__notify as jest.Mock
const mockCopy = copy as jest.Mock
const mockFetchMoreLikeThis = jest.requireMock('@/service/share').fetchMoreLikeThis as jest.Mock
const mockUpdateFeedback = jest.requireMock('@/service/share').updateFeedback as jest.Mock
const mockFetchTextGenerationMessage = jest.requireMock('@/service/debug').fetchTextGenerationMessage as jest.Mock
const contentSectionCalls = jest.requireMock('./content-section').__calls as any[]
const metaSectionCalls = jest.requireMock('./meta-section').__calls as any[]

const translations = {
  wait: 'please-wait',
  copySuccess: 'copied',
}

const getBaseProps = (overrides?: Partial<IGenerationItemProps>): IGenerationItemProps => ({
  isError: false,
  onRetry: jest.fn(),
  content: 'response text',
  messageId: 'message-1',
  moreLikeThis: true,
  isInstalledApp: false,
  siteInfo: null,
  supportFeedback: true,
  ...overrides,
})

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('GenerationItem', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    metaSectionCalls.length = 0
    contentSectionCalls.length = 0
    mockUseParams.mockReturnValue({ appId: 'app-123' })
    mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child-answer', id: 'child-id' })
  })

  it('exports a memoized component', () => {
    expect((GenerationItem as any).$$typeof).toBe(Symbol.for('react.memo'))
  })

  it('shows loading indicator when isLoading is true', () => {
    render(<GenerationItem {...getBaseProps({ isLoading: true })} />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('prevents requesting more-like-this when message id is missing', async () => {
    const user = userEvent.setup()
    render(<GenerationItem {...getBaseProps({ messageId: null })} />)

    await user.click(screen.getByTestId('more-like-none'))

    expect(mockFetchMoreLikeThis).not.toHaveBeenCalled()
    expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      message: translations.wait,
    }))
  })

  it('guards more-like-this while querying', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<{ answer: string; id: string }>()
    mockFetchMoreLikeThis.mockReturnValueOnce(deferred.promise)

    render(<GenerationItem {...getBaseProps()} />)

    await user.click(screen.getByTestId('more-like-message-1'))
    await waitFor(() => expect(mockFetchMoreLikeThis).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(metaSectionCalls.length).toBeGreaterThan(1))

    await user.click(screen.getByTestId('more-like-message-1'))
    expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      message: translations.wait,
    }))

    deferred.resolve({ answer: 'child-deferred', id: 'deferred-id' })
    await waitFor(() => expect(screen.getByTestId('meta-section-deferred-id')).toBeInTheDocument())
  })

  it('fetches more-like-this content and renders the child item', async () => {
    const user = userEvent.setup()
    mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child content', id: 'child-generated' })

    render(<GenerationItem {...getBaseProps()} />)

    await user.click(screen.getByTestId('more-like-message-1'))

    await waitFor(() => expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('message-1', false, undefined))
    await waitFor(() => expect(screen.getByTestId('meta-section-child-generated')).toBeInTheDocument())
    expect(metaSectionCalls.some(call => call.messageId === 'child-generated')).toBe(true)
  })

  it('opens log modal and formats the log payload', async () => {
    const user = userEvent.setup()
    const logResponse = {
      message: [{ role: 'user', text: 'hi' }],
      answer: 'assistant answer',
      message_files: [
        { id: 'a1', belongs_to: 'assistant' },
        { id: 'u1', belongs_to: 'user' },
      ],
    }
    mockFetchTextGenerationMessage.mockResolvedValue(logResponse)

    render(<GenerationItem {...getBaseProps({ messageId: 'log-id' })} />)

    await user.click(screen.getByTestId('open-log-log-id'))

    await waitFor(() => expect(mockFetchTextGenerationMessage).toHaveBeenCalledWith({ appId: 'app-123', messageId: 'log-id' }))
    expect(mockStore.setCurrentLogItem).toHaveBeenCalledWith(expect.objectContaining({
      log: expect.arrayContaining([
        expect.objectContaining({ role: 'user', text: 'hi' }),
        expect.objectContaining({
          role: 'assistant',
          text: 'assistant answer',
          files: [{ id: 'a1', belongs_to: 'assistant' }],
        }),
      ]),
    }))
    expect(mockStore.setShowPromptLogModal).toHaveBeenCalledWith(true)
  })

  it('copies plain and structured content for non-workflow responses', async () => {
    const user = userEvent.setup()

    render(<GenerationItem {...getBaseProps({ messageId: 'copy-plain', moreLikeThis: false, content: 'copy me' })} />)
    await user.click(screen.getByTestId('copy-copy-plain'))
    expect(mockCopy).toHaveBeenCalledWith('copy me')

    render(<GenerationItem {...getBaseProps({ messageId: 'copy-object', moreLikeThis: false, content: { foo: 'bar' } })} />)
    await user.click(screen.getByTestId('copy-copy-object'))
    expect(mockCopy).toHaveBeenCalledWith(JSON.stringify({ foo: 'bar' }))

    expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      message: translations.copySuccess,
    }))
  })

  it('copies workflow result text when available', async () => {
    const user = userEvent.setup()
    render(
      <GenerationItem
        {...getBaseProps({
          messageId: 'workflow-id',
          isWorkflow: true,
          moreLikeThis: false,
          workflowProcessData: { resultText: 'workflow result' } as any,
        })}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('copy-workflow-id')).toBeInTheDocument())
    await user.click(screen.getByTestId('copy-workflow-id'))

    expect(mockCopy).toHaveBeenCalledWith('workflow result')
  })

  it('updates feedback for generated child message', async () => {
    const user = userEvent.setup()
    mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child response', id: 'child-feedback' })

    render(<GenerationItem {...getBaseProps({ isInstalledApp: true, installedAppId: 'install-1' })} />)

    await user.click(screen.getByTestId('more-like-message-1'))
    await waitFor(() => expect(screen.getByTestId('feedback-child-feedback')).toBeInTheDocument())

    await user.click(screen.getByTestId('feedback-child-feedback'))

    expect(mockUpdateFeedback).toHaveBeenCalledWith(
      { url: '/messages/child-feedback/feedbacks', body: { rating: 'like' } },
      true,
      'install-1',
    )
  })

  it('clears generated child when controlClearMoreLikeThis changes', async () => {
    const user = userEvent.setup()
    mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child response', id: 'child-to-clear' })
    const baseProps = getBaseProps()
    const { rerender } = render(<GenerationItem {...baseProps} />)

    await user.click(screen.getByTestId('more-like-message-1'))
    await waitFor(() => expect(screen.getByTestId('meta-section-child-to-clear')).toBeInTheDocument())

    rerender(<GenerationItem {...baseProps} controlClearMoreLikeThis={1} />)

    await waitFor(() => expect(screen.queryByTestId('meta-section-child-to-clear')).not.toBeInTheDocument())
  })

  it('disables more-like-this at maximum depth', () => {
    render(<GenerationItem {...getBaseProps({ depth: 3, messageId: 'max-depth' })} />)
    expect(screen.getByTestId('more-like-max-depth')).toBeDisabled()
  })

  it('keeps copy handler stable when unrelated props change', () => {
    const props = getBaseProps({ messageId: 'stable-copy', moreLikeThis: false })
    const { rerender } = render(<GenerationItem {...props} />)
    const firstOnCopy = metaSectionCalls[metaSectionCalls.length - 1].onCopy

    rerender(<GenerationItem {...props} className="changed" />)
    const lastOnCopy = metaSectionCalls[metaSectionCalls.length - 1].onCopy

    expect(firstOnCopy).toBe(lastOnCopy)
  })
})
