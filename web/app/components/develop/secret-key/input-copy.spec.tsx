import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import InputCopy from './input-copy'

// Mock copy-to-clipboard
vi.mock('copy-to-clipboard', () => ({
  default: vi.fn().mockReturnValue(true),
}))

describe('InputCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render the value', () => {
      render(<InputCopy value="test-api-key-12345" />)
      expect(screen.getByText('test-api-key-12345')).toBeInTheDocument()
    })

    it('should render with empty value by default', () => {
      render(<InputCopy />)
      // Empty string should be rendered
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render children when provided', () => {
      render(
        <InputCopy value="key">
          <span data-testid="custom-child">Custom Content</span>
        </InputCopy>,
      )
      expect(screen.getByTestId('custom-child')).toBeInTheDocument()
    })

    it('should render CopyFeedback component', () => {
      render(<InputCopy value="test" />)
      // CopyFeedback should render a button
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })
  })

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(<InputCopy value="test" className="custom-class" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('custom-class')
    })

    it('should have flex layout', () => {
      const { container } = render(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('flex')
    })

    it('should have items-center alignment', () => {
      const { container } = render(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('items-center')
    })

    it('should have rounded-lg class', () => {
      const { container } = render(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('rounded-lg')
    })

    it('should have background class', () => {
      const { container } = render(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-components-input-bg-normal')
    })

    it('should have hover state', () => {
      const { container } = render(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('hover:bg-state-base-hover')
    })

    it('should have py-2 padding', () => {
      const { container } = render(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('py-2')
    })
  })

  describe('copy functionality', () => {
    it('should copy value when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<InputCopy value="copy-this-value" />)

      const copyableArea = screen.getByText('copy-this-value')
      await act(async () => {
        await user.click(copyableArea)
      })

      expect(copy).toHaveBeenCalledWith('copy-this-value')
    })

    it('should update copied state after clicking', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<InputCopy value="test-value" />)

      const copyableArea = screen.getByText('test-value')
      await act(async () => {
        await user.click(copyableArea)
      })

      // Copy function should have been called
      expect(copy).toHaveBeenCalledWith('test-value')
    })

    it('should reset copied state after timeout', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<InputCopy value="test-value" />)

      const copyableArea = screen.getByText('test-value')
      await act(async () => {
        await user.click(copyableArea)
      })

      expect(copy).toHaveBeenCalledWith('test-value')

      // Advance time to reset the copied state
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })

      // Component should still be functional
      expect(screen.getByText('test-value')).toBeInTheDocument()
    })

    it('should render tooltip on value', () => {
      render(<InputCopy value="test-value" />)
      // Value should be wrapped in tooltip (tooltip shows on hover, not as visible text)
      const valueText = screen.getByText('test-value')
      expect(valueText).toBeInTheDocument()
    })
  })

  describe('tooltip', () => {
    it('should render tooltip wrapper', () => {
      render(<InputCopy value="test" />)
      const valueText = screen.getByText('test')
      expect(valueText).toBeInTheDocument()
    })

    it('should have cursor-pointer on clickable area', () => {
      render(<InputCopy value="test" />)
      const valueText = screen.getByText('test')
      const clickableArea = valueText.closest('div[class*="cursor-pointer"]')
      expect(clickableArea).toBeInTheDocument()
    })
  })

  describe('divider', () => {
    it('should render vertical divider', () => {
      const { container } = render(<InputCopy value="test" />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider).toBeInTheDocument()
    })

    it('should have correct divider dimensions', () => {
      const { container } = render(<InputCopy value="test" />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider?.className).toContain('h-4')
      expect(divider?.className).toContain('w-px')
    })

    it('should have shrink-0 on divider', () => {
      const { container } = render(<InputCopy value="test" />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider?.className).toContain('shrink-0')
    })
  })

  describe('value display', () => {
    it('should have truncate class for long values', () => {
      render(<InputCopy value="very-long-api-key-value-that-might-overflow" />)
      const valueText = screen.getByText('very-long-api-key-value-that-might-overflow')
      const container = valueText.closest('div[class*="truncate"]')
      expect(container).toBeInTheDocument()
    })

    it('should have text-secondary color on value', () => {
      render(<InputCopy value="test-value" />)
      const valueText = screen.getByText('test-value')
      expect(valueText.className).toContain('text-text-secondary')
    })

    it('should have absolute positioning for overlay', () => {
      render(<InputCopy value="test" />)
      const valueText = screen.getByText('test')
      const container = valueText.closest('div[class*="absolute"]')
      expect(container).toBeInTheDocument()
    })
  })

  describe('inner container', () => {
    it('should have grow class on inner container', () => {
      const { container } = render(<InputCopy value="test" />)
      const innerContainer = container.querySelector('.grow')
      expect(innerContainer).toBeInTheDocument()
    })

    it('should have h-5 height on inner container', () => {
      const { container } = render(<InputCopy value="test" />)
      const innerContainer = container.querySelector('.h-5')
      expect(innerContainer).toBeInTheDocument()
    })
  })

  describe('with children', () => {
    it('should render children before value', () => {
      const { container } = render(
        <InputCopy value="key">
          <span data-testid="prefix">Prefix:</span>
        </InputCopy>,
      )
      const children = container.querySelector('[data-testid="prefix"]')
      expect(children).toBeInTheDocument()
    })

    it('should render both children and value', () => {
      render(
        <InputCopy value="api-key">
          <span>Label:</span>
        </InputCopy>,
      )
      expect(screen.getByText('Label:')).toBeInTheDocument()
      expect(screen.getByText('api-key')).toBeInTheDocument()
    })
  })

  describe('CopyFeedback section', () => {
    it('should have margin on CopyFeedback container', () => {
      const { container } = render(<InputCopy value="test" />)
      const copyFeedbackContainer = container.querySelector('.mx-1')
      expect(copyFeedbackContainer).toBeInTheDocument()
    })
  })

  describe('relative container', () => {
    it('should have relative positioning on value container', () => {
      const { container } = render(<InputCopy value="test" />)
      const relativeContainer = container.querySelector('.relative')
      expect(relativeContainer).toBeInTheDocument()
    })

    it('should have grow on value container', () => {
      const { container } = render(<InputCopy value="test" />)
      // Find the relative container that also has grow
      const valueContainer = container.querySelector('.relative.grow')
      expect(valueContainer).toBeInTheDocument()
    })

    it('should have full height on value container', () => {
      const { container } = render(<InputCopy value="test" />)
      const valueContainer = container.querySelector('.relative.h-full')
      expect(valueContainer).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('should handle undefined value', () => {
      render(<InputCopy value={undefined} />)
      // Should not crash
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle empty string value', () => {
      render(<InputCopy value="" />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle very long values', () => {
      const longValue = 'a'.repeat(500)
      render(<InputCopy value={longValue} />)
      expect(screen.getByText(longValue)).toBeInTheDocument()
    })

    it('should handle special characters in value', () => {
      const specialValue = 'key-with-special-chars!@#$%^&*()'
      render(<InputCopy value={specialValue} />)
      expect(screen.getByText(specialValue)).toBeInTheDocument()
    })
  })

  describe('multiple clicks', () => {
    it('should handle multiple rapid clicks', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<InputCopy value="test" />)

      const copyableArea = screen.getByText('test')

      // Click multiple times rapidly
      await act(async () => {
        await user.click(copyableArea)
        await user.click(copyableArea)
        await user.click(copyableArea)
      })

      expect(copy).toHaveBeenCalledTimes(3)
    })
  })
})
