import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AppSourceType } from '@/service/share'
import GenerationActionGroups from '../action-groups'

const mockCopy = vi.fn()
const mockSuccess = vi.fn()
const mockOnFeedback = vi.fn()
const mockOnMoreLikeThis = vi.fn()
const mockOnOpenLog = vi.fn()
const mockOnRetry = vi.fn()
const mockOnSave = vi.fn()
vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
  },
}))

describe('GenerationActionGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should copy content and show a success toast', async () => {
    const user = userEvent.setup()
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
        onOpenLog={mockOnOpenLog}
        onRetry={mockOnRetry}
        onSave={mockOnSave}
        supportFeedback
      />,
    )

    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.copy(?=$|:)/ }))

    expect(mockCopy).toHaveBeenCalledWith('hello world')
    expect(mockSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)actionMsg\.copySuccessfully(?=$|:)/),
    )
  })

  it('should handle more-like-this and feedback actions', async () => {
    const user = userEvent.setup()
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
        onOpenLog={mockOnOpenLog}
        onRetry={mockOnRetry}
        onSave={mockOnSave}
        supportFeedback
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)feature\.moreLikeThis\.title(?=$|:)/ }),
    )
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.agree(?=$|:)/ }))
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))

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
        onOpenLog={mockOnOpenLog}
        onRetry={mockOnRetry}
      />,
    )

    expect(
      screen.getByRole('button', { name: /(?:^|\.)feature\.moreLikeThis\.title(?=$|:)/ }),
    ).toBeDisabled()
  })

  it('should hide the log action when the owner does not provide it', () => {
    render(
      <GenerationActionGroups
        appSourceType={AppSourceType.webApp}
        content="hello world"
        currentTab="DETAIL"
        depth={1}
        isError={false}
        isInWebApp={false}
        messageId="msg-1"
        onMoreLikeThis={mockOnMoreLikeThis}
        onRetry={mockOnRetry}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /(?:^|\.)operation\.log(?=$|:)/ }),
    ).not.toBeInTheDocument()
  })

  it('should stringify non-string content before copying', async () => {
    const user = userEvent.setup()
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
        onOpenLog={mockOnOpenLog}
        onRetry={mockOnRetry}
      />,
    )

    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.copy(?=$|:)/ }))

    expect(mockCopy).toHaveBeenCalledWith(JSON.stringify({ result: 'hello world' }))
  })

  it('should expose retry and disagree actions in the appropriate states', async () => {
    const user = userEvent.setup()
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
        onOpenLog={mockOnOpenLog}
        onRetry={mockOnRetry}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)generation\.batchFailed\.retry(?=$|:)/ }),
    )

    expect(mockOnRetry).toHaveBeenCalledTimes(1)
  })

  it('selects and clears both feedback ratings through the controlled result', async () => {
    const user = userEvent.setup()
    function ResultActions() {
      const [rating, setRating] = useState<'like' | 'dislike' | null>(null)
      return (
        <GenerationActionGroups
          appSourceType={AppSourceType.webApp}
          content="hello"
          currentTab="DETAIL"
          depth={1}
          feedback={{ rating }}
          isError={false}
          isInWebApp
          messageId="msg-4"
          onFeedback={(next) => {
            setRating(next.rating)
            mockOnFeedback(next)
          }}
          onMoreLikeThis={mockOnMoreLikeThis}
          onOpenLog={mockOnOpenLog}
          onRetry={mockOnRetry}
        />
      )
    }
    render(<ResultActions />)
    for (const [action, rating] of [
      ['agree', 'like'],
      ['disagree', 'dislike'],
    ] as const) {
      const button = screen.getByRole('button', { name: new RegExp(`operation\\.${action}$`) })
      await user.click(button)
      expect(mockOnFeedback).toHaveBeenLastCalledWith({ rating })
      const selectedButton = screen.getByRole('button', { pressed: true })
      await user.click(selectedButton)
      expect(mockOnFeedback).toHaveBeenLastCalledWith({ rating: null })
      expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
    }
  })
})
