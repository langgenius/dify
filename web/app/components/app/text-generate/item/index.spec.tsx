import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import type { IGenerationItemProps } from './index'
import GenerationItem from './index'

// ============================================================================
// Mock Setup
// ============================================================================

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: jest.fn(() => ({ appId: 'app-123' })),
}))

jest.mock('@/app/components/base/chat/chat/context', () => ({
  useChatContext: () => ({
    config: { text_to_speech: { voice: 'en-test' } },
  }),
}))

jest.mock('@/app/components/app/store', () => {
  const mockSetCurrentLogItem = jest.fn()
  const mockSetShowPromptLogModal = jest.fn()
  return {
    useStore: (selector: (state: Record<string, jest.Mock>) => jest.Mock) => {
      const store = {
        setCurrentLogItem: mockSetCurrentLogItem,
        setShowPromptLogModal: mockSetShowPromptLogModal,
      }
      return selector(store)
    },
    __mockSetCurrentLogItem: mockSetCurrentLogItem,
    __mockSetShowPromptLogModal: mockSetShowPromptLogModal,
  }
})

jest.mock('@/app/components/base/toast', () => {
  const mockToastNotify = jest.fn()
  return {
    __esModule: true,
    default: { notify: mockToastNotify },
    __mockToastNotify: mockToastNotify,
  }
})

jest.mock('copy-to-clipboard', () => ({
  __esModule: true,
  default: jest.fn(),
}))

jest.mock('@/service/share', () => {
  const mockFetchMoreLikeThis = jest.fn()
  const mockUpdateFeedback = jest.fn()
  return {
    __esModule: true,
    fetchMoreLikeThis: mockFetchMoreLikeThis,
    updateFeedback: mockUpdateFeedback,
  }
})

jest.mock('@/service/debug', () => {
  const mockFetchTextGenerationMessage = jest.fn()
  return {
    __esModule: true,
    fetchTextGenerationMessage: mockFetchTextGenerationMessage,
  }
})

jest.mock('@/app/components/base/loading', () => ({
  __esModule: true,
  default: () => <div data-testid="loading" />,
}))

// Simple mock for ContentSection - just render content
jest.mock('./content-section', () => {
  const mockContentSection = jest.fn()
  const Component = (props: Record<string, unknown>) => {
    mockContentSection(props)
    return (
      <div data-testid={`content-section-${props.taskId ?? 'none'}`}>
        {typeof props.content === 'string' ? props.content : 'content'}
      </div>
    )
  }
  return {
    __esModule: true,
    default: Component,
    __mockContentSection: mockContentSection,
  }
})

// Simple mock for MetaSection - expose action buttons based on props
jest.mock('./meta-section', () => {
  const mockMetaSection = jest.fn()
  const Component = (props: Record<string, unknown>) => {
    mockMetaSection(props)
    const {
      messageId,
      isError,
      moreLikeThis,
      disableMoreLikeThis,
      canCopy,
      isInWebApp,
      isInstalledApp,
      isResponding,
      isWorkflow,
      supportFeedback,
      onOpenLogModal,
      onMoreLikeThis,
      onCopy,
      onRetry,
      onSave,
      onFeedback,
      showCharCount,
      charCount,
    } = props as {
      messageId?: string | null
      isError?: boolean
      moreLikeThis?: boolean
      disableMoreLikeThis?: boolean
      canCopy?: boolean
      isInWebApp?: boolean
      isInstalledApp?: boolean
      isResponding?: boolean
      isWorkflow?: boolean
      supportFeedback?: boolean
      onOpenLogModal?: () => void
      onMoreLikeThis?: () => void
      onCopy?: () => void
      onRetry?: () => void
      onSave?: (id: string) => void
      onFeedback?: (feedback: { rating: string | null }) => void
      showCharCount?: boolean
      charCount?: number
    }

    return (
      <div data-testid={`meta-section-${messageId ?? 'none'}`}>
        {showCharCount && (
          <span data-testid={`char-count-${messageId ?? 'none'}`}>{charCount}</span>
        )}
        {!isInWebApp && !isInstalledApp && !isResponding && (
          <button
            data-testid={`open-log-${messageId ?? 'none'}`}
            disabled={!messageId || isError}
            onClick={onOpenLogModal}
          >
            open-log
          </button>
        )}
        {moreLikeThis && (
          <button
            data-testid={`more-like-${messageId ?? 'none'}`}
            disabled={disableMoreLikeThis}
            onClick={onMoreLikeThis}
          >
            more-like
          </button>
        )}
        {canCopy && (
          <button
            data-testid={`copy-${messageId ?? 'none'}`}
            disabled={!messageId || isError}
            onClick={onCopy}
          >
            copy
          </button>
        )}
        {isInWebApp && isError && (
          <button data-testid={`retry-${messageId ?? 'none'}`} onClick={onRetry}>
            retry
          </button>
        )}
        {isInWebApp && !isWorkflow && (
          <button
            data-testid={`save-${messageId ?? 'none'}`}
            disabled={!messageId || isError}
            onClick={() => onSave?.(messageId as string)}
          >
            save
          </button>
        )}
        {(supportFeedback || isInWebApp) && !isWorkflow && !isError && messageId && onFeedback && (
          <button
            data-testid={`feedback-${messageId}`}
            onClick={() => onFeedback({ rating: 'like' })}
          >
            feedback
          </button>
        )}
      </div>
    )
  }
  return {
    __esModule: true,
    default: Component,
    __mockMetaSection: mockMetaSection,
  }
})

const mockCopy = copy as jest.Mock
const mockUseParams = jest.requireMock('next/navigation').useParams as jest.Mock
const mockToastNotify = jest.requireMock('@/app/components/base/toast').__mockToastNotify as jest.Mock
const mockSetCurrentLogItem = jest.requireMock('@/app/components/app/store').__mockSetCurrentLogItem as jest.Mock
const mockSetShowPromptLogModal = jest.requireMock('@/app/components/app/store').__mockSetShowPromptLogModal as jest.Mock
const mockFetchMoreLikeThis = jest.requireMock('@/service/share').fetchMoreLikeThis as jest.Mock
const mockUpdateFeedback = jest.requireMock('@/service/share').updateFeedback as jest.Mock
const mockFetchTextGenerationMessage = jest.requireMock('@/service/debug').fetchTextGenerationMessage as jest.Mock
const mockContentSection = jest.requireMock('./content-section').__mockContentSection as jest.Mock
const mockMetaSection = jest.requireMock('./meta-section').__mockMetaSection as jest.Mock

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates base props with sensible defaults for GenerationItem testing.
 * Uses factory pattern for flexible test data creation.
 */
const createBaseProps = (overrides?: Partial<IGenerationItemProps>): IGenerationItemProps => ({
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

/**
 * Creates a deferred promise for testing async flows.
 */
const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('GenerationItem', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseParams.mockReturnValue({ appId: 'app-123' })
    mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child-answer', id: 'child-id' })
  })

  // --------------------------------------------------------------------------
  // Component Structure Tests
  // Tests verifying the component's export type and basic structure
  // --------------------------------------------------------------------------
  describe('Component Structure', () => {
    it('should export a memoized component', () => {
      expect((GenerationItem as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // Tests for the loading indicator display behavior
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should show loading indicator when isLoading is true', () => {
      render(<GenerationItem {...createBaseProps({ isLoading: true })} />)
      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should not show loading indicator when isLoading is false', () => {
      render(<GenerationItem {...createBaseProps({ isLoading: false })} />)
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    })

    it('should not show loading indicator when isLoading is undefined', () => {
      render(<GenerationItem {...createBaseProps()} />)
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // More Like This Feature Tests
  // Tests for the "more like this" generation functionality
  // --------------------------------------------------------------------------
  describe('More Like This Feature', () => {
    it('should prevent request when message id is null', async () => {
      const user = userEvent.setup()
      render(<GenerationItem {...createBaseProps({ messageId: null })} />)

      await user.click(screen.getByTestId('more-like-none'))

      expect(mockFetchMoreLikeThis).not.toHaveBeenCalled()
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: 'appDebug.errorMessage.waitForResponse',
        }),
      )
    })

    it('should prevent request when message id is undefined', async () => {
      const user = userEvent.setup()
      render(<GenerationItem {...createBaseProps({ messageId: undefined })} />)

      await user.click(screen.getByTestId('more-like-none'))

      expect(mockFetchMoreLikeThis).not.toHaveBeenCalled()
    })

    it('should guard against duplicate requests while querying', async () => {
      const user = userEvent.setup()
      const deferred = createDeferred<{ answer: string; id: string }>()
      mockFetchMoreLikeThis.mockReturnValueOnce(deferred.promise)

      render(<GenerationItem {...createBaseProps()} />)

      // First click starts query
      await user.click(screen.getByTestId('more-like-message-1'))
      await waitFor(() => expect(mockFetchMoreLikeThis).toHaveBeenCalledTimes(1))

      // Second click while querying should show warning
      await user.click(screen.getByTestId('more-like-message-1'))
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: 'appDebug.errorMessage.waitForResponse',
        }),
      )

      // Resolve and verify child renders
      deferred.resolve({ answer: 'child-deferred', id: 'deferred-id' })
      await waitFor(() =>
        expect(screen.getByTestId('meta-section-deferred-id')).toBeInTheDocument(),
      )
    })

    it('should fetch and render child item on successful request', async () => {
      const user = userEvent.setup()
      mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child content', id: 'child-generated' })

      render(<GenerationItem {...createBaseProps()} />)

      await user.click(screen.getByTestId('more-like-message-1'))

      await waitFor(() =>
        expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('message-1', false, undefined),
      )
      await waitFor(() =>
        expect(screen.getByTestId('meta-section-child-generated')).toBeInTheDocument(),
      )
    })

    it('should disable more-like-this button at maximum depth', () => {
      render(<GenerationItem {...createBaseProps({ depth: 3, messageId: 'max-depth' })} />)
      expect(screen.getByTestId('more-like-max-depth')).toBeDisabled()
    })

    it('should clear generated child when controlClearMoreLikeThis changes', async () => {
      const user = userEvent.setup()
      mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child response', id: 'child-to-clear' })
      const baseProps = createBaseProps()
      const { rerender } = render(<GenerationItem {...baseProps} />)

      await user.click(screen.getByTestId('more-like-message-1'))
      await waitFor(() =>
        expect(screen.getByTestId('meta-section-child-to-clear')).toBeInTheDocument(),
      )

      rerender(<GenerationItem {...baseProps} controlClearMoreLikeThis={1} />)

      await waitFor(() =>
        expect(screen.queryByTestId('meta-section-child-to-clear')).not.toBeInTheDocument(),
      )
    })

    it('should pass correct installedAppId to fetchMoreLikeThis', async () => {
      const user = userEvent.setup()
      render(
        <GenerationItem
          {...createBaseProps({ isInstalledApp: true, installedAppId: 'install-123' })}
        />,
      )

      await user.click(screen.getByTestId('more-like-message-1'))

      await waitFor(() =>
        expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('message-1', true, 'install-123'),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Log Modal Tests
  // Tests for opening and formatting the log modal
  // --------------------------------------------------------------------------
  describe('Log Modal', () => {
    it('should open log modal and format payload with array message', async () => {
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

      render(<GenerationItem {...createBaseProps({ messageId: 'log-id' })} />)

      await user.click(screen.getByTestId('open-log-log-id'))

      await waitFor(() =>
        expect(mockFetchTextGenerationMessage).toHaveBeenCalledWith({
          appId: 'app-123',
          messageId: 'log-id',
        }),
      )
      expect(mockSetCurrentLogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          log: expect.arrayContaining([
            expect.objectContaining({ role: 'user', text: 'hi' }),
            expect.objectContaining({
              role: 'assistant',
              text: 'assistant answer',
              files: [{ id: 'a1', belongs_to: 'assistant' }],
            }),
          ]),
        }),
      )
      expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(true)
    })

    it('should format log payload with string message', async () => {
      const user = userEvent.setup()
      mockFetchTextGenerationMessage.mockResolvedValue({
        message: 'simple string message',
        answer: 'response',
      })

      render(<GenerationItem {...createBaseProps({ messageId: 'string-log' })} />)

      await user.click(screen.getByTestId('open-log-string-log'))

      await waitFor(() =>
        expect(mockSetCurrentLogItem).toHaveBeenCalledWith(
          expect.objectContaining({
            log: [{ text: 'simple string message' }],
          }),
        ),
      )
    })

    it('should not fetch log when messageId is null', async () => {
      const user = userEvent.setup()
      render(<GenerationItem {...createBaseProps({ messageId: null })} />)

      // Button should be disabled, but if clicked nothing happens
      const button = screen.getByTestId('open-log-none')
      expect(button).toBeDisabled()

      await user.click(button)
      expect(mockFetchTextGenerationMessage).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Copy Functionality Tests
  // Tests for copying content to clipboard
  // --------------------------------------------------------------------------
  describe('Copy Functionality', () => {
    it('should copy plain string content', async () => {
      const user = userEvent.setup()

      render(
        <GenerationItem
          {...createBaseProps({ messageId: 'copy-plain', moreLikeThis: false, content: 'copy me' })}
        />,
      )

      await user.click(screen.getByTestId('copy-copy-plain'))

      expect(mockCopy).toHaveBeenCalledWith('copy me')
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          message: 'common.actionMsg.copySuccessfully',
        }),
      )
    })

    it('should copy JSON stringified object content', async () => {
      const user = userEvent.setup()

      render(
        <GenerationItem
          {...createBaseProps({
            messageId: 'copy-object',
            moreLikeThis: false,
            content: { foo: 'bar' },
          })}
        />,
      )

      await user.click(screen.getByTestId('copy-copy-object'))

      expect(mockCopy).toHaveBeenCalledWith(JSON.stringify({ foo: 'bar' }))
    })

    it('should copy workflow result text when available', async () => {
      const user = userEvent.setup()
      render(
        <GenerationItem
          {...createBaseProps({
            messageId: 'workflow-id',
            isWorkflow: true,
            moreLikeThis: false,
            workflowProcessData: { resultText: 'workflow result' } as IGenerationItemProps['workflowProcessData'],
          })}
        />,
      )

      await waitFor(() => expect(screen.getByTestId('copy-workflow-id')).toBeInTheDocument())
      await user.click(screen.getByTestId('copy-workflow-id'))

      expect(mockCopy).toHaveBeenCalledWith('workflow result')
    })

    it('should handle empty string content', async () => {
      const user = userEvent.setup()

      render(
        <GenerationItem
          {...createBaseProps({ messageId: 'copy-empty', moreLikeThis: false, content: '' })}
        />,
      )

      await user.click(screen.getByTestId('copy-copy-empty'))

      expect(mockCopy).toHaveBeenCalledWith('')
    })
  })

  // --------------------------------------------------------------------------
  // Feedback Tests
  // Tests for the feedback functionality on child messages
  // --------------------------------------------------------------------------
  describe('Feedback', () => {
    it('should update feedback for generated child message', async () => {
      const user = userEvent.setup()
      mockFetchMoreLikeThis.mockResolvedValue({ answer: 'child response', id: 'child-feedback' })

      render(
        <GenerationItem
          {...createBaseProps({ isInstalledApp: true, installedAppId: 'install-1' })}
        />,
      )

      await user.click(screen.getByTestId('more-like-message-1'))
      await waitFor(() =>
        expect(screen.getByTestId('feedback-child-feedback')).toBeInTheDocument(),
      )

      await user.click(screen.getByTestId('feedback-child-feedback'))

      expect(mockUpdateFeedback).toHaveBeenCalledWith(
        { url: '/messages/child-feedback/feedbacks', body: { rating: 'like' } },
        true,
        'install-1',
      )
    })
  })

  // --------------------------------------------------------------------------
  // Props Passing Tests
  // Tests verifying correct props are passed to child components
  // --------------------------------------------------------------------------
  describe('Props Passing', () => {
    it('should pass correct props to ContentSection', () => {
      render(
        <GenerationItem
          {...createBaseProps({
            taskId: 'task-123',
            isError: true,
            content: 'test content',
            hideProcessDetail: true,
          })}
        />,
      )

      expect(mockContentSection).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          isError: true,
          content: 'test content',
          hideProcessDetail: true,
          depth: 1,
        }),
      )
    })

    it('should pass correct props to MetaSection', () => {
      render(
        <GenerationItem
          {...createBaseProps({
            messageId: 'meta-test',
            isError: false,
            moreLikeThis: true,
            supportFeedback: true,
          })}
        />,
      )

      expect(mockMetaSection).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'meta-test',
          isError: false,
          moreLikeThis: true,
          supportFeedback: true,
          showCharCount: true,
        }),
      )
    })

    it('should set showCharCount to false for workflow', () => {
      render(<GenerationItem {...createBaseProps({ isWorkflow: true })} />)

      expect(mockMetaSection).toHaveBeenCalledWith(
        expect.objectContaining({
          showCharCount: false,
        }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Callback Tests
  // Tests verifying callbacks function correctly
  // --------------------------------------------------------------------------
  describe('Callback Behavior', () => {
    it('should provide a working copy handler to MetaSection', async () => {
      const user = userEvent.setup()
      render(
        <GenerationItem
          {...createBaseProps({ messageId: 'callback-test', moreLikeThis: false, content: 'test copy' })}
        />,
      )

      await user.click(screen.getByTestId('copy-callback-test'))

      expect(mockCopy).toHaveBeenCalledWith('test copy')
    })

    it('should provide a working more like this handler to MetaSection', async () => {
      const user = userEvent.setup()
      render(<GenerationItem {...createBaseProps({ messageId: 'callback-more' })} />)

      await user.click(screen.getByTestId('more-like-callback-more'))

      await waitFor(() =>
        expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('callback-more', false, undefined),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Boundary Condition Tests
  // Tests for edge cases and boundary conditions
  // --------------------------------------------------------------------------
  describe('Boundary Conditions', () => {
    it('should handle null content gracefully', () => {
      render(<GenerationItem {...createBaseProps({ content: null })} />)
      expect(screen.getByTestId('content-section-none')).toBeInTheDocument()
    })

    it('should handle undefined content gracefully', () => {
      render(<GenerationItem {...createBaseProps({ content: undefined })} />)
      expect(screen.getByTestId('content-section-none')).toBeInTheDocument()
    })

    it('should handle empty object content', () => {
      render(<GenerationItem {...createBaseProps({ content: {} })} />)
      expect(screen.getByTestId('content-section-none')).toBeInTheDocument()
    })

    it('should handle depth at boundary (depth = 1)', () => {
      render(<GenerationItem {...createBaseProps({ depth: 1 })} />)
      expect(mockMetaSection).toHaveBeenCalledWith(
        expect.objectContaining({
          disableMoreLikeThis: false,
        }),
      )
    })

    it('should handle depth at boundary (depth = 2)', () => {
      render(<GenerationItem {...createBaseProps({ depth: 2 })} />)
      expect(mockMetaSection).toHaveBeenCalledWith(
        expect.objectContaining({
          disableMoreLikeThis: false,
        }),
      )
    })

    it('should handle depth at maximum (depth = 3)', () => {
      render(<GenerationItem {...createBaseProps({ depth: 3 })} />)
      expect(mockMetaSection).toHaveBeenCalledWith(
        expect.objectContaining({
          disableMoreLikeThis: true,
        }),
      )
    })

    it('should handle missing appId in params', async () => {
      const user = userEvent.setup()
      mockUseParams.mockReturnValue({})

      render(<GenerationItem {...createBaseProps({ messageId: 'no-app' })} />)

      await user.click(screen.getByTestId('open-log-no-app'))

      await waitFor(() =>
        expect(mockFetchTextGenerationMessage).toHaveBeenCalledWith({
          appId: undefined,
          messageId: 'no-app',
        }),
      )
    })

    it('should render with all optional props undefined', () => {
      const minimalProps: IGenerationItemProps = {
        isError: false,
        onRetry: jest.fn(),
        content: 'content',
        isInstalledApp: false,
        siteInfo: null,
      }
      render(<GenerationItem {...minimalProps} />)
      expect(screen.getByTestId('meta-section-none')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Error State Tests
  // Tests for error handling and error state display
  // --------------------------------------------------------------------------
  describe('Error States', () => {
    it('should pass isError to child components', () => {
      render(<GenerationItem {...createBaseProps({ isError: true, messageId: 'error-id' })} />)

      expect(mockContentSection).toHaveBeenCalledWith(
        expect.objectContaining({ isError: true }),
      )
      expect(mockMetaSection).toHaveBeenCalledWith(
        expect.objectContaining({ isError: true }),
      )
    })

    it('should show retry button in web app error state', () => {
      render(
        <GenerationItem
          {...createBaseProps({ isError: true, isInWebApp: true, messageId: 'retry-error' })}
        />,
      )

      expect(screen.getByTestId('retry-retry-error')).toBeInTheDocument()
    })

    it('should disable copy button on error', () => {
      render(
        <GenerationItem
          {...createBaseProps({ isError: true, messageId: 'copy-error', moreLikeThis: false })}
        />,
      )

      expect(screen.getByTestId('copy-copy-error')).toBeDisabled()
    })
  })
})
