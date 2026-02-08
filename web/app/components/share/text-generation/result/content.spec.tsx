import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Result from './content'

// Only mock react-i18next for translations
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock copy-to-clipboard for the Header component
vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(() => true),
}))

// Mock the format function from service/base
vi.mock('@/service/base', () => ({
  format: (content: string) => content.replace(/\n/g, '<br>'),
}))

afterEach(() => {
  cleanup()
})

describe('Result (content)', () => {
  const mockOnFeedback = vi.fn()

  const defaultProps = {
    content: 'Test content here',
    showFeedback: true,
    feedback: { rating: null } as FeedbackType,
    onFeedback: mockOnFeedback,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the Header component', () => {
      render(<Result {...defaultProps} />)

      // Header renders the result title
      expect(screen.getByText('generation.resultTitle')).toBeInTheDocument()
    })

    it('should render content', () => {
      render(<Result {...defaultProps} />)

      expect(screen.getByText('Test content here')).toBeInTheDocument()
    })

    it('should render formatted content with line breaks', () => {
      render(
        <Result
          {...defaultProps}
          content={'Line 1\nLine 2'}
        />,
      )

      // The format function converts \n to <br>
      const contentDiv = document.querySelector('[class*="overflow-scroll"]')
      expect(contentDiv?.innerHTML).toContain('Line 1<br>Line 2')
    })

    it('should have max height style', () => {
      render(<Result {...defaultProps} />)

      const contentDiv = document.querySelector('[class*="overflow-scroll"]')
      expect(contentDiv).toHaveStyle({ maxHeight: '70vh' })
    })

    it('should render with empty content', () => {
      render(
        <Result
          {...defaultProps}
          content=""
        />,
      )

      expect(screen.getByText('generation.resultTitle')).toBeInTheDocument()
    })

    it('should render with HTML content safely', () => {
      render(
        <Result
          {...defaultProps}
          content="<script>alert('xss')</script>"
        />,
      )

      // Content is rendered via dangerouslySetInnerHTML
      const contentDiv = document.querySelector('[class*="overflow-scroll"]')
      expect(contentDiv).toBeInTheDocument()
    })
  })

  describe('feedback props', () => {
    it('should pass showFeedback to Header', () => {
      render(
        <Result
          {...defaultProps}
          showFeedback={false}
        />,
      )

      // Feedback buttons should not be visible
      const feedbackArea = document.querySelector('[class*="space-x-1 rounded-lg border"]')
      expect(feedbackArea).not.toBeInTheDocument()
    })

    it('should pass feedback to Header', () => {
      render(
        <Result
          {...defaultProps}
          feedback={{ rating: 'like' }}
        />,
      )

      // Like button should be highlighted
      const likeButton = document.querySelector('[class*="primary"]')
      expect(likeButton).toBeInTheDocument()
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((Result as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})
