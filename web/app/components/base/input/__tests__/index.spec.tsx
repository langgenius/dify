import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { createReactI18nextMock } from '@/test/i18n-mock'
import Input, { inputVariants } from '../index'

// Mock the i18n hook with custom translations for test assertions
vi.mock('react-i18next', () => createReactI18nextMock({
  'operation.search': 'Search',
  'placeholder.input': 'Please input',
}))

describe('Input component', () => {
  describe('Variants', () => {
    it('should return correct classes for regular size', () => {
      const result = inputVariants({ size: 'regular' })
      expect(result).toContain('px-3')
      expect(result).toContain('rounded-lg')
      expect(result).toContain('system-sm-regular')
    })

    it('should return correct classes for large size', () => {
      const result = inputVariants({ size: 'large' })
      expect(result).toContain('px-4')
      expect(result).toContain('rounded-[10px]')
      expect(result).toContain('system-md-regular')
    })

    it('should use regular size as default', () => {
      const result = inputVariants({})
      expect(result).toContain('px-3')
      expect(result).toContain('rounded-lg')
      expect(result).toContain('system-sm-regular')
    })
  })

  it('renders correctly with default props', () => {
    render(<Input />)
    const input = screen.getByPlaceholderText(/input/i)
    expect(input)!.toBeInTheDocument()
    expect(input).not.toBeDisabled()
    expect(input).not.toHaveClass('cursor-not-allowed')
  })

  it('shows left icon when showLeftIcon is true', () => {
    render(<Input showLeftIcon />)
    const searchIcon = document.querySelector('.i-ri-search-line')
    expect(searchIcon)!.toBeInTheDocument()
    const input = screen.getByPlaceholderText(/search/i)
    expect(input)!.toHaveClass('pl-[26px]')
  })

  it('shows clear icon when showClearIcon is true and has value', () => {
    render(<Input showClearIcon value="test" />)
    const clearIcon = document.querySelector('.i-ri-close-circle-fill')
    expect(clearIcon)!.toBeInTheDocument()
    const input = screen.getByDisplayValue('test')
    expect(input)!.toHaveClass('pr-[26px]')
  })

  it('does not show clear icon when disabled, even with value', () => {
    render(<Input showClearIcon value="test" disabled />)
    const clearIcon = document.querySelector('.i-ri-close-circle-fill')
    expect(clearIcon).not.toBeInTheDocument()
  })

  it('calls onClear when clear icon is clicked', () => {
    const onClear = vi.fn()
    render(<Input showClearIcon value="test" onClear={onClear} />)
    const clearIconContainer = screen.getByRole('button', { name: 'common.operation.clear' })
    fireEvent.click(clearIconContainer!)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows warning icon when destructive is true', () => {
    render(<Input destructive />)
    const warningIcon = document.querySelector('.i-ri-error-warning-line')
    expect(warningIcon)!.toBeInTheDocument()
    const input = screen.getByPlaceholderText(/input/i)
    expect(input)!.toHaveClass('border-components-input-border-destructive')
  })

  it('applies disabled styles when disabled', () => {
    render(<Input disabled />)
    const input = screen.getByPlaceholderText(/input/i)
    expect(input)!.toBeDisabled()
    expect(input)!.toHaveClass('cursor-not-allowed')
    expect(input)!.toHaveClass('bg-components-input-bg-disabled')
  })

  it('displays custom unit when provided', () => {
    render(<Input unit="km" />)
    const unitElement = screen.getByText('km')
    expect(unitElement)!.toBeInTheDocument()
  })

  it('applies custom className and style', () => {
    const customClass = 'test-class'
    const customStyle = { color: 'red' }
    render(<Input className={customClass} styleCss={customStyle} />)
    const input = screen.getByPlaceholderText(/input/i)
    expect(input)!.toHaveClass(customClass)
    expect(input)!.toHaveStyle({ color: 'red' })
  })

  it('applies large size variant correctly', () => {
    render(<Input size="large" />)
    const input = screen.getByPlaceholderText('Please input')
    expect(input.className).toContain(inputVariants({ size: 'large' }))
  })

  it('uses custom placeholder when provided', () => {
    const placeholder = 'Custom placeholder'
    render(<Input placeholder={placeholder} />)
    const input = screen.getByPlaceholderText(placeholder)
    expect(input)!.toBeInTheDocument()
  })

  describe('Additional Layout Branches', () => {
    it('applies pl-7 when showLeftIcon and size is large', () => {
      render(<Input showLeftIcon size="large" />)
      const input = screen.getByRole('textbox')
      expect(input)!.toHaveClass('pl-7')
    })

    it('applies pr-7 when showClearIcon, has value, and size is large', () => {
      render(<Input showClearIcon value="123" size="large" onChange={vi.fn()} />)
      const input = screen.getByRole('textbox')
      expect(input)!.toHaveClass('pr-7')
    })

    it('applies pr-7 when destructive and size is large', () => {
      render(<Input destructive size="large" />)
      const input = screen.getByRole('textbox')
      expect(input)!.toHaveClass('pr-7')
    })

    it('shows copy icon and applies pr-[26px] when showCopyIcon is true', () => {
      render(<Input showCopyIcon />)
      const input = screen.getByRole('textbox')
      expect(input)!.toHaveClass('pr-[26px]')
      // Assert that CopyFeedbackNew wrapper is present
      const copyWrapper = document.querySelector('.group.absolute.right-0')
      expect(copyWrapper)!.toBeInTheDocument()
    })

    it('shows copy icon and applies pr-7 when showCopyIcon and size is large', () => {
      render(<Input showCopyIcon size="large" value="my-val" onChange={vi.fn()} />)
      const input = screen.getByRole('textbox')
      expect(input)!.toHaveClass('pr-7')
    })
  })

  describe('Number Input Formatting', () => {
    it('removes leading zeros on change when current value is zero', () => {
      let changedValue = ''
      const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
        changedValue = e.target.value
      })
      render(<Input type="number" value={0} onChange={onChange} />)

      const input = screen.getByRole('spinbutton') as HTMLInputElement
      fireEvent.change(input, { target: { value: '00042' } })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(changedValue).toBe('42')
    })

    it('does not normalize when value is 0 and input value is already normalized', () => {
      const onChange = vi.fn()
      render(<Input type="number" value={0} onChange={onChange} />)

      const input = screen.getByRole('spinbutton') as HTMLInputElement
      // The event value ('1') is already normalized, preventing e.target.value reassignment
      fireEvent.change(input, { target: { value: '1' } })

      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('keeps typed value on change when current value is not zero', () => {
      let changedValue = ''
      const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
        changedValue = e.target.value
      })
      render(<Input type="number" value={1} onChange={onChange} />)

      const input = screen.getByRole('spinbutton') as HTMLInputElement
      fireEvent.change(input, { target: { value: '00042' } })
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(changedValue).toBe('00042')
    })

    it('normalizes value and triggers change on blur-sm when leading zeros exist', () => {
      const onChange = vi.fn()
      const onBlur = vi.fn()
      render(<Input type="number" defaultValue="0012" onChange={onChange} onBlur={onBlur} />)

      const input = screen.getByRole('spinbutton')
      fireEvent.blur(input)

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange.mock.calls[0]![0].type).toBe('change')
      expect(onChange.mock.calls[0]![0].target.value).toBe('12')
      expect(onBlur).toHaveBeenCalledTimes(1)
      expect(onBlur.mock.calls[0]![0].target.value).toBe('12')
    })

    it('does not trigger change on blur-sm when value is already normalized', () => {
      const onChange = vi.fn()
      const onBlur = vi.fn()
      render(<Input type="number" defaultValue="12" onChange={onChange} onBlur={onBlur} />)

      const input = screen.getByRole('spinbutton')
      fireEvent.blur(input)

      expect(onChange).not.toHaveBeenCalled()
      expect(onBlur).toHaveBeenCalledTimes(1)
      expect(onBlur.mock.calls[0]![0].target.value).toBe('12')
    })
  })
})
