import { fireEvent, render, screen } from '@testing-library/react'
import CopyFeedback, { CopyFeedbackNew } from '..'

const mockCopy = vi.fn()
const mockReset = vi.fn()
let mockCopied = false

vi.mock('@/hooks/use-clipboard', () => ({
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
      const button = screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' })
      fireEvent.click(button)
      expect(mockCopy).toHaveBeenCalledWith('test content')
    })

    it('does not reset on mouse leave (relies on hook timeout)', () => {
      render(<CopyFeedback content="test content" />)
      const button = screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' })
      fireEvent.mouseLeave(button)
      expect(mockReset).not.toHaveBeenCalled()
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
      render(<CopyFeedbackNew content="test content" />)
      expect(screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' })).toBeInTheDocument()
    })

    it('renders with custom className', () => {
      const { container } = render(<CopyFeedbackNew content="test content" className="test-class" />)
      expect(container.querySelector('.test-class')).toBeInTheDocument()
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
      render(<CopyFeedbackNew content="test content" />)
      fireEvent.click(screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' }))
      expect(mockCopy).toHaveBeenCalledWith('test content')
    })

    it('does not reset on mouse leave (relies on hook timeout)', () => {
      render(<CopyFeedbackNew content="test content" />)
      fireEvent.mouseLeave(screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' }))
      expect(mockReset).not.toHaveBeenCalled()
    })
  })
})
