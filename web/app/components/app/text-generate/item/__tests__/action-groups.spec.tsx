import { fireEvent, render, screen } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import GenerationActionGroups from '../action-groups'

const mockCopy = vi.fn()
const mockSuccess = vi.fn()
const mockOnFeedback = vi.fn()
const mockOnMoreLikeThis = vi.fn()
const mockOnOpenLogModal = vi.fn()
const mockOnRetry = vi.fn()
const mockOnSave = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
  },
}))

describe('GenerationActionGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should copy content and show a success toast', () => {
    render(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="hello world"
        currentTab="DETAIL"
        depth={1}
        isError={false}
        isInWebApp
        messageId="msg-1"
        onFeedback={mockOnFeedback}
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
        onSave={mockOnSave}
        supportFeedback
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'operation.copy' }))

    expect(mockCopy).toHaveBeenCalledWith('hello world')
    expect(mockSuccess).toHaveBeenCalledWith('actionMsg.copySuccessfully')
  })

  it('should handle more-like-this and feedback actions', () => {
    render(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="hello world"
        currentTab="DETAIL"
        depth={1}
        feedback={{ rating: null }}
        isError={false}
        isInWebApp
        messageId="msg-1"
        moreLikeThis
        onFeedback={mockOnFeedback}
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
        onSave={mockOnSave}
        supportFeedback
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'feature.moreLikeThis.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'operation.agree' }))
    fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

    expect(mockOnMoreLikeThis).toHaveBeenCalledTimes(1)
    expect(mockOnFeedback).toHaveBeenCalledWith({ rating: 'like' })
    expect(mockOnSave).toHaveBeenCalledWith('msg-1')
  })

  it('should disable more-like-this when recursion reaches the limit', () => {
    render(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="hello world"
        currentTab="DETAIL"
        depth={3}
        isError={false}
        isInWebApp={false}
        messageId="msg-1"
        moreLikeThis
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
      />,
    )

    expect(screen.getByRole('button', { name: 'feature.moreLikeThis.title' })).toBeDisabled()
  })

  it('should stringify non-string content before copying', () => {
    render(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content={{ result: 'hello world' }}
        currentTab="DETAIL"
        depth={1}
        isError={false}
        isInWebApp
        messageId="msg-2"
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'operation.copy' }))

    expect(mockCopy).toHaveBeenCalledWith(JSON.stringify({ result: 'hello world' }))
  })

  it('should expose retry and disagree actions in the appropriate states', () => {
    render(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="failed"
        currentTab="DETAIL"
        depth={1}
        feedback={{ rating: null }}
        isError
        isInWebApp
        messageId="msg-3"
        onFeedback={mockOnFeedback}
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'generation.batchFailed.retry' }))

    expect(mockOnRetry).toHaveBeenCalledTimes(1)
  })

  it('should support disagree and cancel feedback actions', () => {
    const { rerender } = render(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="hello"
        currentTab="DETAIL"
        depth={1}
        feedback={{ rating: null }}
        isError={false}
        isInWebApp
        messageId="msg-4"
        onFeedback={mockOnFeedback}
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'operation.disagree' }))
    expect(mockOnFeedback).toHaveBeenCalledWith({ rating: 'dislike' })

    rerender(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="hello"
        currentTab="DETAIL"
        depth={1}
        feedback={{ rating: 'like' }}
        isError={false}
        isInWebApp
        messageId="msg-4"
        onFeedback={mockOnFeedback}
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'operation.cancelAgree' }))
    expect(mockOnFeedback).toHaveBeenCalledWith({ rating: null })

    rerender(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="hello"
        currentTab="DETAIL"
        depth={1}
        feedback={{ rating: 'dislike' }}
        isError={false}
        isInWebApp
        messageId="msg-4"
        onFeedback={mockOnFeedback}
        onMoreLikeThis={mockOnMoreLikeThis}
        onOpenLogModal={mockOnOpenLogModal}
        onRetry={mockOnRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'operation.cancelDisagree' }))
    expect(mockOnFeedback).toHaveBeenCalledWith({ rating: null })
  })
})
