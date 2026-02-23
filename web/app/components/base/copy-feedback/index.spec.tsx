import { fireEvent, render, screen } from '@testing-library/react'
import CopyFeedback, { CopyFeedbackNew } from '.'

const mockCopy = vi.fn()
const mockReset = vi.fn()
let mockCopied = false

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: mockCopy,
    reset: mockReset,
    copied: mockCopied,
  }),
}))

describe('CopyFeedback', () => {
  beforeEach(() => {
    mockCopied = false
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders the action button with copy icon', () => {
      render(<CopyFeedback content="test content" />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('renders the copied icon when copied is true', () => {
      mockCopied = true
      render(<CopyFeedback content="test content" />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('calls copy with content when clicked', () => {
      render(<CopyFeedback content="test content" />)
      const button = screen.getByRole('button')
      fireEvent.click(button.firstChild as Element)
      expect(mockCopy).toHaveBeenCalledWith('test content')
    })

    it('calls reset on mouse leave', () => {
      render(<CopyFeedback content="test content" />)
      const button = screen.getByRole('button')
      fireEvent.mouseLeave(button.firstChild as Element)
      expect(mockReset).toHaveBeenCalledTimes(1)
    })
  })
})

describe('CopyFeedbackNew', () => {
  beforeEach(() => {
    mockCopied = false
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders the component', () => {
      const { container } = render(<CopyFeedbackNew content="test content" />)
      expect(container.querySelector('.cursor-pointer')).toBeInTheDocument()
    })

    it('applies copied CSS class when copied is true', () => {
      mockCopied = true
      const { container } = render(<CopyFeedbackNew content="test content" />)
      const feedbackIcon = container.firstChild?.firstChild as Element
      expect(feedbackIcon).toHaveClass(/_copied_.*/)
    })

    it('does not apply copied CSS class when not copied', () => {
      const { container } = render(<CopyFeedbackNew content="test content" />)
      const feedbackIcon = container.firstChild?.firstChild as Element
      expect(feedbackIcon).not.toHaveClass(/_copied_.*/)
    })
  })

  describe('User Interactions', () => {
    it('calls copy with content when clicked', () => {
      const { container } = render(<CopyFeedbackNew content="test content" />)
      const clickableArea = container.querySelector('.cursor-pointer')!.firstChild as HTMLElement
      fireEvent.click(clickableArea)
      expect(mockCopy).toHaveBeenCalledWith('test content')
    })

    it('calls reset on mouse leave', () => {
      const { container } = render(<CopyFeedbackNew content="test content" />)
      const clickableArea = container.querySelector('.cursor-pointer')!.firstChild as HTMLElement
      fireEvent.mouseLeave(clickableArea)
      expect(mockReset).toHaveBeenCalledTimes(1)
    })
  })
})
