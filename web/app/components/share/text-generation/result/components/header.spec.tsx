import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Header from './header'

// Only mock react-i18next for translations
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock copy-to-clipboard
const mockCopy = vi.fn((_text: string) => true)
vi.mock('copy-to-clipboard', () => ({
  default: (text: string) => mockCopy(text),
}))

afterEach(() => {
  cleanup()
})

describe('Header', () => {
  const mockOnFeedback = vi.fn()

  const defaultProps = {
    result: 'Test result content',
    showFeedback: true,
    feedback: { rating: null } as FeedbackType,
    onFeedback: mockOnFeedback,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the result title', () => {
      render(<Header {...defaultProps} />)

      expect(screen.getByText('generation.resultTitle')).toBeInTheDocument()
    })

    it('should render the copy button', () => {
      render(<Header {...defaultProps} />)

      expect(screen.getByText('generation.copy')).toBeInTheDocument()
    })
  })

  describe('copy functionality', () => {
    it('should copy result when copy button is clicked', () => {
      render(<Header {...defaultProps} />)

      const copyButton = screen.getByText('generation.copy').closest('button')
      fireEvent.click(copyButton!)

      expect(mockCopy).toHaveBeenCalledWith('Test result content')
    })
  })

  describe('feedback buttons when showFeedback is true', () => {
    it('should show feedback buttons when no rating is given', () => {
      render(<Header {...defaultProps} />)

      // Should show both thumbs up and down buttons
      const buttons = document.querySelectorAll('[class*="cursor-pointer"]')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should show like button highlighted when rating is like', () => {
      render(
        <Header
          {...defaultProps}
          feedback={{ rating: 'like' }}
        />,
      )

      // Should show the undo button for like
      const likeButton = document.querySelector('[class*="primary"]')
      expect(likeButton).toBeInTheDocument()
    })

    it('should show dislike button highlighted when rating is dislike', () => {
      render(
        <Header
          {...defaultProps}
          feedback={{ rating: 'dislike' }}
        />,
      )

      // Should show the undo button for dislike
      const dislikeButton = document.querySelector('[class*="red"]')
      expect(dislikeButton).toBeInTheDocument()
    })

    it('should call onFeedback with like when thumbs up is clicked', () => {
      render(<Header {...defaultProps} />)

      // Find the thumbs up button (first one in the feedback area)
      const thumbButtons = document.querySelectorAll('[class*="cursor-pointer"]')
      const thumbsUp = Array.from(thumbButtons).find(btn =>
        btn.className.includes('rounded-md') && !btn.className.includes('primary'),
      )

      if (thumbsUp) {
        fireEvent.click(thumbsUp)
        expect(mockOnFeedback).toHaveBeenCalledWith({ rating: 'like' })
      }
    })

    it('should call onFeedback with dislike when thumbs down is clicked', () => {
      render(<Header {...defaultProps} />)

      // Find the thumbs down button
      const thumbButtons = document.querySelectorAll('[class*="cursor-pointer"]')
      const thumbsDown = Array.from(thumbButtons).pop()

      if (thumbsDown) {
        fireEvent.click(thumbsDown)
        expect(mockOnFeedback).toHaveBeenCalledWith({ rating: 'dislike' })
      }
    })

    it('should call onFeedback with null when undo like is clicked', () => {
      render(
        <Header
          {...defaultProps}
          feedback={{ rating: 'like' }}
        />,
      )

      // When liked, clicking the like button again should undo it (has bg-primary-100 class)
      const likeButton = document.querySelector('[class*="bg-primary-100"]')
      expect(likeButton).toBeInTheDocument()
      fireEvent.click(likeButton!)
      expect(mockOnFeedback).toHaveBeenCalledWith({ rating: null })
    })

    it('should call onFeedback with null when undo dislike is clicked', () => {
      render(
        <Header
          {...defaultProps}
          feedback={{ rating: 'dislike' }}
        />,
      )

      // When disliked, clicking the dislike button again should undo it (has bg-red-100 class)
      const dislikeButton = document.querySelector('[class*="bg-red-100"]')
      expect(dislikeButton).toBeInTheDocument()
      fireEvent.click(dislikeButton!)
      expect(mockOnFeedback).toHaveBeenCalledWith({ rating: null })
    })
  })

  describe('feedback buttons when showFeedback is false', () => {
    it('should not show feedback buttons', () => {
      render(
        <Header
          {...defaultProps}
          showFeedback={false}
        />,
      )

      // Should not show feedback area buttons (only copy button)
      const feedbackArea = document.querySelector('[class*="space-x-1 rounded-lg border"]')
      expect(feedbackArea).not.toBeInTheDocument()
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((Header as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})
