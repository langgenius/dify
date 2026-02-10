import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatusHeader from './status-header'

describe('StatusHeader', () => {
  const defaultProps = {
    isEmbedding: false,
    isCompleted: false,
    isPaused: false,
    isError: false,
    onPause: vi.fn(),
    onResume: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<StatusHeader {...defaultProps} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      const { container } = render(<StatusHeader {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'h-6', 'items-center', 'gap-x-1')
    })
  })

  describe('Status Text', () => {
    it('should display processing text when isEmbedding is true', () => {
      render(<StatusHeader {...defaultProps} isEmbedding />)
      expect(screen.getByText(/embedding\.processing/i)).toBeInTheDocument()
    })

    it('should display completed text when isCompleted is true', () => {
      render(<StatusHeader {...defaultProps} isCompleted />)
      expect(screen.getByText(/embedding\.completed/i)).toBeInTheDocument()
    })

    it('should display paused text when isPaused is true', () => {
      render(<StatusHeader {...defaultProps} isPaused />)
      expect(screen.getByText(/embedding\.paused/i)).toBeInTheDocument()
    })

    it('should display error text when isError is true', () => {
      render(<StatusHeader {...defaultProps} isError />)
      expect(screen.getByText(/embedding\.error/i)).toBeInTheDocument()
    })

    it('should display empty text when no status flags are set', () => {
      render(<StatusHeader {...defaultProps} />)
      const statusText = screen.getByText('', { selector: 'span.system-md-semibold-uppercase' })
      expect(statusText).toBeInTheDocument()
    })
  })

  describe('Loading Spinner', () => {
    it('should show loading spinner when isEmbedding is true', () => {
      const { container } = render(<StatusHeader {...defaultProps} isEmbedding />)
      const spinner = container.querySelector('svg.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('should not show loading spinner when isEmbedding is false', () => {
      const { container } = render(<StatusHeader {...defaultProps} isEmbedding={false} />)
      const spinner = container.querySelector('svg.animate-spin')
      expect(spinner).not.toBeInTheDocument()
    })
  })

  describe('Pause Button', () => {
    it('should show pause button when isEmbedding is true', () => {
      render(<StatusHeader {...defaultProps} isEmbedding />)
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/embedding\.pause/i)).toBeInTheDocument()
    })

    it('should not show pause button when isEmbedding is false', () => {
      render(<StatusHeader {...defaultProps} isEmbedding={false} />)
      expect(screen.queryByText(/embedding\.pause/i)).not.toBeInTheDocument()
    })

    it('should call onPause when pause button is clicked', () => {
      const onPause = vi.fn()
      render(<StatusHeader {...defaultProps} isEmbedding onPause={onPause} />)
      fireEvent.click(screen.getByRole('button'))
      expect(onPause).toHaveBeenCalledTimes(1)
    })

    it('should disable pause button when isPauseLoading is true', () => {
      render(<StatusHeader {...defaultProps} isEmbedding isPauseLoading />)
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  describe('Resume Button', () => {
    it('should show resume button when isPaused is true', () => {
      render(<StatusHeader {...defaultProps} isPaused />)
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/embedding\.resume/i)).toBeInTheDocument()
    })

    it('should not show resume button when isPaused is false', () => {
      render(<StatusHeader {...defaultProps} isPaused={false} />)
      expect(screen.queryByText(/embedding\.resume/i)).not.toBeInTheDocument()
    })

    it('should call onResume when resume button is clicked', () => {
      const onResume = vi.fn()
      render(<StatusHeader {...defaultProps} isPaused onResume={onResume} />)
      fireEvent.click(screen.getByRole('button'))
      expect(onResume).toHaveBeenCalledTimes(1)
    })

    it('should disable resume button when isResumeLoading is true', () => {
      render(<StatusHeader {...defaultProps} isPaused isResumeLoading />)
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  describe('Button Styles', () => {
    it('should have correct button styles for pause button', () => {
      render(<StatusHeader {...defaultProps} isEmbedding />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex', 'items-center', 'gap-x-1', 'rounded-md')
    })

    it('should have correct button styles for resume button', () => {
      render(<StatusHeader {...defaultProps} isPaused />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex', 'items-center', 'gap-x-1', 'rounded-md')
    })
  })

  describe('Edge Cases', () => {
    it('should not show any buttons when isCompleted', () => {
      render(<StatusHeader {...defaultProps} isCompleted />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should not show any buttons when isError', () => {
      render(<StatusHeader {...defaultProps} isError />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should show both buttons when isEmbedding and isPaused are both true', () => {
      render(<StatusHeader {...defaultProps} isEmbedding isPaused />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2)
    })
  })
})
