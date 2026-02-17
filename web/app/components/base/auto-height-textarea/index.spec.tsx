import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { sleep } from '@/utils'
import AutoHeightTextarea from './index'

vi.mock('@/utils', async () => {
  const actual = await vi.importActual('@/utils')
  return {
    ...actual,
    sleep: vi.fn(),
  }
})

describe('AutoHeightTextarea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<AutoHeightTextarea value="" onChange={vi.fn()} />)
      const textarea = container.querySelector('textarea')
      expect(textarea).toBeInTheDocument()
    })

    it('should render with placeholder when value is empty', () => {
      render(<AutoHeightTextarea placeholder="Enter text" value="" onChange={vi.fn()} />)
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
    })

    it('should render with value', () => {
      render(<AutoHeightTextarea value="Hello World" onChange={vi.fn()} />)
      const textarea = screen.getByDisplayValue('Hello World')
      expect(textarea).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className to textarea', () => {
      const { container } = render(<AutoHeightTextarea value="" onChange={vi.fn()} className="custom-class" />)
      const textarea = container.querySelector('textarea')
      expect(textarea).toHaveClass('custom-class')
    })

    it('should apply custom wrapperClassName to wrapper div', () => {
      const { container } = render(<AutoHeightTextarea value="" onChange={vi.fn()} wrapperClassName="wrapper-class" />)
      const wrapper = container.querySelector('div.relative')
      expect(wrapper).toHaveClass('wrapper-class')
    })

    it('should apply minHeight and maxHeight styles to hidden div', () => {
      const { container } = render(<AutoHeightTextarea value="" onChange={vi.fn()} minHeight={50} maxHeight={200} />)
      const hiddenDiv = container.querySelector('div.invisible')
      expect(hiddenDiv).toHaveStyle({ minHeight: '50px', maxHeight: '200px' })
    })

    it('should use default minHeight and maxHeight when not provided', () => {
      const { container } = render(<AutoHeightTextarea value="" onChange={vi.fn()} />)
      const hiddenDiv = container.querySelector('div.invisible')
      expect(hiddenDiv).toHaveStyle({ minHeight: '36px', maxHeight: '96px' })
    })

    it('should set autoFocus on textarea', () => {
      const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
      render(<AutoHeightTextarea value="" onChange={vi.fn()} autoFocus />)
      expect(focusSpy).toHaveBeenCalled()
      focusSpy.mockRestore()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when textarea value changes', () => {
      const handleChange = vi.fn()
      render(<AutoHeightTextarea value="" onChange={handleChange} />)
      const textarea = screen.getByRole('textbox')

      fireEvent.change(textarea, { target: { value: 'new value' } })

      expect(handleChange).toHaveBeenCalledTimes(1)
    })

    it('should call onKeyDown when key is pressed', () => {
      const handleKeyDown = vi.fn()
      render(<AutoHeightTextarea value="" onChange={vi.fn()} onKeyDown={handleKeyDown} />)
      const textarea = screen.getByRole('textbox')

      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(handleKeyDown).toHaveBeenCalledTimes(1)
    })

    it('should call onKeyUp when key is released', () => {
      const handleKeyUp = vi.fn()
      render(<AutoHeightTextarea value="" onChange={vi.fn()} onKeyUp={handleKeyUp} />)
      const textarea = screen.getByRole('textbox')

      fireEvent.keyUp(textarea, { key: 'Enter' })

      expect(handleKeyUp).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string value', () => {
      render(<AutoHeightTextarea value="" onChange={vi.fn()} />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('')
    })

    it('should handle whitespace-only value', () => {
      render(<AutoHeightTextarea value="   " onChange={vi.fn()} />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('   ')
    })

    it('should handle very long text (>10000 chars)', () => {
      const longText = 'a'.repeat(10001)
      render(<AutoHeightTextarea value={longText} onChange={vi.fn()} />)
      const textarea = screen.getByDisplayValue(longText)
      expect(textarea).toBeInTheDocument()
    })

    it('should handle newlines in value', () => {
      const textWithNewlines = 'line1\nline2\nline3'
      render(<AutoHeightTextarea value={textWithNewlines} onChange={vi.fn()} />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue(textWithNewlines)
    })

    it('should handle special characters in value', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      render(<AutoHeightTextarea value={specialChars} onChange={vi.fn()} />)
      const textarea = screen.getByDisplayValue(specialChars)
      expect(textarea).toBeInTheDocument()
    })
  })

  describe('Ref forwarding', () => {
    it('should accept ref and allow focusing', () => {
      const ref = { current: null as HTMLTextAreaElement | null }
      render(<AutoHeightTextarea ref={ref as React.RefObject<HTMLTextAreaElement>} value="" onChange={vi.fn()} />)

      expect(ref.current).not.toBeNull()
      expect(ref.current?.tagName).toBe('TEXTAREA')
    })
  })

  describe('controlFocus prop', () => {
    it('should call focus when controlFocus changes', () => {
      const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
      const { rerender } = render(<AutoHeightTextarea value="" onChange={vi.fn()} controlFocus={1} />)

      expect(focusSpy).toHaveBeenCalledTimes(1)

      rerender(<AutoHeightTextarea value="" onChange={vi.fn()} controlFocus={2} />)

      expect(focusSpy).toHaveBeenCalledTimes(2)
      focusSpy.mockRestore()
    })

    it('should retry focus recursively when ref is not ready during autoFocus', async () => {
      const delayedRef = {} as React.RefObject<HTMLTextAreaElement>
      let assignedNode: HTMLTextAreaElement | null = null
      let exposedNode: HTMLTextAreaElement | null = null

      Object.defineProperty(delayedRef, 'current', {
        get: () => exposedNode,
        set: (value: HTMLTextAreaElement | null) => {
          assignedNode = value
        },
      })

      const sleepMock = vi.mocked(sleep)
      let sleepCalls = 0
      sleepMock.mockImplementation(async () => {
        sleepCalls += 1
        if (sleepCalls === 2)
          exposedNode = assignedNode
      })

      const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
      const setSelectionRangeSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange')

      render(<AutoHeightTextarea ref={delayedRef} value="" onChange={vi.fn()} autoFocus />)

      await waitFor(() => {
        expect(sleepMock).toHaveBeenCalledTimes(2)
        expect(focusSpy).toHaveBeenCalled()
        expect(setSelectionRangeSpy).toHaveBeenCalledTimes(1)
      })

      focusSpy.mockRestore()
      setSelectionRangeSpy.mockRestore()
    })
  })

  describe('displayName', () => {
    it('should have displayName set', () => {
      expect(AutoHeightTextarea.displayName).toBe('AutoHeightTextarea')
    })
  })
})
