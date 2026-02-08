import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProgressBar from './progress-bar'

describe('ProgressBar', () => {
  const defaultProps = {
    percent: 50,
    isEmbedding: false,
    isCompleted: false,
    isPaused: false,
    isError: false,
  }

  const getProgressElements = (container: HTMLElement) => {
    const wrapper = container.firstChild as HTMLElement
    const progressBar = wrapper.firstChild as HTMLElement
    return { wrapper, progressBar }
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ProgressBar {...defaultProps} />)
      const { wrapper, progressBar } = getProgressElements(container)
      expect(wrapper).toBeInTheDocument()
      expect(progressBar).toBeInTheDocument()
    })

    it('should render progress bar container with correct classes', () => {
      const { container } = render(<ProgressBar {...defaultProps} />)
      const { wrapper } = getProgressElements(container)
      expect(wrapper).toHaveClass('flex', 'h-2', 'w-full', 'items-center', 'overflow-hidden', 'rounded-md')
    })

    it('should render inner progress bar with transition classes', () => {
      const { container } = render(<ProgressBar {...defaultProps} />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveClass('h-full', 'transition-all', 'duration-300')
    })
  })

  describe('Progress Width', () => {
    it('should set progress width to 0%', () => {
      const { container } = render(<ProgressBar {...defaultProps} percent={0} />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveStyle({ width: '0%' })
    })

    it('should set progress width to 50%', () => {
      const { container } = render(<ProgressBar {...defaultProps} percent={50} />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveStyle({ width: '50%' })
    })

    it('should set progress width to 100%', () => {
      const { container } = render(<ProgressBar {...defaultProps} percent={100} />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveStyle({ width: '100%' })
    })

    it('should set progress width to 75%', () => {
      const { container } = render(<ProgressBar {...defaultProps} percent={75} />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveStyle({ width: '75%' })
    })
  })

  describe('Container Background States', () => {
    it('should apply semi-transparent background when isEmbedding is true', () => {
      const { container } = render(<ProgressBar {...defaultProps} isEmbedding />)
      const { wrapper } = getProgressElements(container)
      expect(wrapper).toHaveClass('bg-components-progress-bar-bg/50')
    })

    it('should apply default background when isEmbedding is false', () => {
      const { container } = render(<ProgressBar {...defaultProps} isEmbedding={false} />)
      const { wrapper } = getProgressElements(container)
      expect(wrapper).toHaveClass('bg-components-progress-bar-bg')
      expect(wrapper).not.toHaveClass('bg-components-progress-bar-bg/50')
    })
  })

  describe('Progress Bar Fill States', () => {
    it('should apply solid progress style when isEmbedding is true', () => {
      const { container } = render(<ProgressBar {...defaultProps} isEmbedding />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveClass('bg-components-progress-bar-progress-solid')
    })

    it('should apply solid progress style when isCompleted is true', () => {
      const { container } = render(<ProgressBar {...defaultProps} isCompleted />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveClass('bg-components-progress-bar-progress-solid')
    })

    it('should apply highlight style when isPaused is true', () => {
      const { container } = render(<ProgressBar {...defaultProps} isPaused />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveClass('bg-components-progress-bar-progress-highlight')
    })

    it('should apply highlight style when isError is true', () => {
      const { container } = render(<ProgressBar {...defaultProps} isError />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveClass('bg-components-progress-bar-progress-highlight')
    })

    it('should not apply fill styles when no status flags are set', () => {
      const { container } = render(<ProgressBar {...defaultProps} />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).not.toHaveClass('bg-components-progress-bar-progress-solid')
      expect(progressBar).not.toHaveClass('bg-components-progress-bar-progress-highlight')
    })
  })

  describe('Combined States', () => {
    it('should apply highlight when isEmbedding and isPaused', () => {
      const { container } = render(<ProgressBar {...defaultProps} isEmbedding isPaused />)
      const { progressBar } = getProgressElements(container)
      // highlight takes precedence since isPaused condition is separate
      expect(progressBar).toHaveClass('bg-components-progress-bar-progress-highlight')
    })

    it('should apply highlight when isCompleted and isError', () => {
      const { container } = render(<ProgressBar {...defaultProps} isCompleted isError />)
      const { progressBar } = getProgressElements(container)
      // highlight takes precedence since isError condition is separate
      expect(progressBar).toHaveClass('bg-components-progress-bar-progress-highlight')
    })

    it('should apply semi-transparent bg for embedding and highlight for paused', () => {
      const { container } = render(<ProgressBar {...defaultProps} isEmbedding isPaused />)
      const { wrapper } = getProgressElements(container)
      expect(wrapper).toHaveClass('bg-components-progress-bar-bg/50')
    })
  })

  describe('Edge Cases', () => {
    it('should handle all props set to false', () => {
      const { container } = render(
        <ProgressBar
          percent={0}
          isEmbedding={false}
          isCompleted={false}
          isPaused={false}
          isError={false}
        />,
      )
      const { wrapper, progressBar } = getProgressElements(container)
      expect(wrapper).toBeInTheDocument()
      expect(progressBar).toHaveStyle({ width: '0%' })
    })

    it('should handle decimal percent values', () => {
      const { container } = render(<ProgressBar {...defaultProps} percent={33.33} />)
      const { progressBar } = getProgressElements(container)
      expect(progressBar).toHaveStyle({ width: '33.33%' })
    })
  })
})
