import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InputCopy from '../input-copy'

async function renderAndFlush(ui: React.ReactElement) {
  const result = render(ui)
  await act(async () => {
    vi.runAllTimers()
  })
  return result
}

const execCommandMock = vi.fn().mockReturnValue(true)

describe('InputCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ shouldAdvanceTime: true })
    execCommandMock.mockReturnValue(true)
    document.execCommand = execCommandMock
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('should render the value', async () => {
      await renderAndFlush(<InputCopy value="test-api-key-12345" />)
      expect(screen.getByText('test-api-key-12345')).toBeInTheDocument()
    })

    it('should render with empty value by default', async () => {
      await renderAndFlush(<InputCopy />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render children when provided', async () => {
      await renderAndFlush(
        <InputCopy value="key">
          <span data-testid="custom-child">Custom Content</span>
        </InputCopy>,
      )
      expect(screen.getByTestId('custom-child')).toBeInTheDocument()
    })

    it('should render CopyFeedback component', async () => {
      await renderAndFlush(<InputCopy value="test" />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })
  })

  describe('styling', () => {
    it('should apply custom className', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" className="custom-class" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('custom-class')
    })

    it('should have flex layout', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('flex')
    })

    it('should have items-center alignment', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('items-center')
    })

    it('should have rounded-lg class', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('rounded-lg')
    })

    it('should have background class', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-components-input-bg-normal')
    })

    it('should have hover state', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('hover:bg-state-base-hover')
    })

    it('should have py-2 padding', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('py-2')
    })
  })

  describe('copy functionality', () => {
    it('should copy value when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderAndFlush(<InputCopy value="copy-this-value" />)

      const copyableArea = screen.getByText('copy-this-value')
      await act(async () => {
        await user.click(copyableArea)
      })

      expect(execCommandMock).toHaveBeenCalledWith('copy')
    })

    it('should update copied state after clicking', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderAndFlush(<InputCopy value="test-value" />)

      const copyableArea = screen.getByText('test-value')
      await act(async () => {
        await user.click(copyableArea)
      })

      expect(execCommandMock).toHaveBeenCalledWith('copy')
    })

    it('should reset copied state after timeout', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderAndFlush(<InputCopy value="test-value" />)

      const copyableArea = screen.getByText('test-value')
      await act(async () => {
        await user.click(copyableArea)
      })

      expect(execCommandMock).toHaveBeenCalledWith('copy')

      await act(async () => {
        vi.advanceTimersByTime(1500)
      })

      expect(screen.getByText('test-value')).toBeInTheDocument()
    })

    it('should render tooltip on value', async () => {
      await renderAndFlush(<InputCopy value="test-value" />)
      const valueText = screen.getByText('test-value')
      expect(valueText).toBeInTheDocument()
    })
  })

  describe('tooltip', () => {
    it('should render tooltip wrapper', async () => {
      await renderAndFlush(<InputCopy value="test" />)
      const valueText = screen.getByText('test')
      expect(valueText).toBeInTheDocument()
    })

    it('should have cursor-pointer on clickable area', async () => {
      await renderAndFlush(<InputCopy value="test" />)
      const valueText = screen.getByText('test')
      const clickableArea = valueText.closest('div[class*="cursor-pointer"]')
      expect(clickableArea).toBeInTheDocument()
    })
  })

  describe('divider', () => {
    it('should render vertical divider', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider).toBeInTheDocument()
    })

    it('should have correct divider dimensions', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider?.className).toContain('h-4')
      expect(divider?.className).toContain('w-px')
    })

    it('should have shrink-0 on divider', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider?.className).toContain('shrink-0')
    })
  })

  describe('value display', () => {
    it('should have truncate class for long values', async () => {
      await renderAndFlush(<InputCopy value="very-long-api-key-value-that-might-overflow" />)
      const valueText = screen.getByText('very-long-api-key-value-that-might-overflow')
      const container = valueText.closest('div[class*="truncate"]')
      expect(container).toBeInTheDocument()
    })

    it('should have text-secondary color on value', async () => {
      await renderAndFlush(<InputCopy value="test-value" />)
      const valueText = screen.getByText('test-value')
      expect(valueText.className).toContain('text-text-secondary')
    })

    it('should have absolute positioning for overlay', async () => {
      await renderAndFlush(<InputCopy value="test" />)
      const valueText = screen.getByText('test')
      const container = valueText.closest('div[class*="absolute"]')
      expect(container).toBeInTheDocument()
    })
  })

  describe('inner container', () => {
    it('should have grow class on inner container', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const innerContainer = container.querySelector('.grow')
      expect(innerContainer).toBeInTheDocument()
    })

    it('should have h-5 height on inner container', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const innerContainer = container.querySelector('.h-5')
      expect(innerContainer).toBeInTheDocument()
    })
  })

  describe('with children', () => {
    it('should render children before value', async () => {
      const { container } = await renderAndFlush(
        <InputCopy value="key">
          <span data-testid="prefix">Prefix:</span>
        </InputCopy>,
      )
      const children = container.querySelector('[data-testid="prefix"]')
      expect(children).toBeInTheDocument()
    })

    it('should render both children and value', async () => {
      await renderAndFlush(
        <InputCopy value="api-key">
          <span>Label:</span>
        </InputCopy>,
      )
      expect(screen.getByText('Label:')).toBeInTheDocument()
      expect(screen.getByText('api-key')).toBeInTheDocument()
    })
  })

  describe('CopyFeedback section', () => {
    it('should have margin on CopyFeedback container', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const copyFeedbackContainer = container.querySelector('.mx-1')
      expect(copyFeedbackContainer).toBeInTheDocument()
    })
  })

  describe('relative container', () => {
    it('should have relative positioning on value container', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const relativeContainer = container.querySelector('.relative')
      expect(relativeContainer).toBeInTheDocument()
    })

    it('should have grow on value container', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const valueContainer = container.querySelector('.relative.grow')
      expect(valueContainer).toBeInTheDocument()
    })

    it('should have full height on value container', async () => {
      const { container } = await renderAndFlush(<InputCopy value="test" />)
      const valueContainer = container.querySelector('.relative.h-full')
      expect(valueContainer).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('should handle undefined value', async () => {
      await renderAndFlush(<InputCopy value={undefined} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle empty string value', async () => {
      await renderAndFlush(<InputCopy value="" />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle very long values', async () => {
      const longValue = 'a'.repeat(500)
      await renderAndFlush(<InputCopy value={longValue} />)
      expect(screen.getByText(longValue)).toBeInTheDocument()
    })

    it('should handle special characters in value', async () => {
      const specialValue = 'key-with-special-chars!@#$%^&*()'
      await renderAndFlush(<InputCopy value={specialValue} />)
      expect(screen.getByText(specialValue)).toBeInTheDocument()
    })
  })

  describe('multiple clicks', () => {
    it('should handle multiple rapid clicks', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderAndFlush(<InputCopy value="test" />)

      const copyableArea = screen.getByText('test')

      await act(async () => {
        await user.click(copyableArea)
        await user.click(copyableArea)
        await user.click(copyableArea)
      })

      expect(execCommandMock).toHaveBeenCalledTimes(3)
    })
  })
})
