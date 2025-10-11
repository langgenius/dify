import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import Input, { inputVariants } from './index'

// Mock the i18n hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common.operation.search': 'Search',
        'common.placeholder.input': 'Please input',
      }
      return translations[key] || ''
    },
  }),
}))

describe('Input component', () => {
  describe('Variants', () => {
    it('should return correct classes for regular size', () => {
      const result = inputVariants({ size: 'regular' })
      expect(result).toContain('px-3')
      expect(result).toContain('radius-md')
      expect(result).toContain('system-sm-regular')
    })

    it('should return correct classes for large size', () => {
      const result = inputVariants({ size: 'large' })
      expect(result).toContain('px-4')
      expect(result).toContain('radius-lg')
      expect(result).toContain('system-md-regular')
    })

    it('should use regular size as default', () => {
      const result = inputVariants({})
      expect(result).toContain('px-3')
      expect(result).toContain('radius-md')
      expect(result).toContain('system-sm-regular')
    })
  })

  it('renders correctly with default props', () => {
    render(<Input />)
    const input = screen.getByPlaceholderText('Please input')
    expect(input).toBeInTheDocument()
    expect(input).not.toBeDisabled()
    expect(input).not.toHaveClass('cursor-not-allowed')
  })

  it('shows left icon when showLeftIcon is true', () => {
    render(<Input showLeftIcon />)
    const searchIcon = document.querySelector('svg')
    expect(searchIcon).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Search')
    expect(input).toHaveClass('pl-[26px]')
  })

  it('shows clear icon when showClearIcon is true and has value', () => {
    render(<Input showClearIcon value="test" />)
    const clearIcon = document.querySelector('.group svg')
    expect(clearIcon).toBeInTheDocument()
    const input = screen.getByDisplayValue('test')
    expect(input).toHaveClass('pr-[26px]')
  })

  it('does not show clear icon when disabled, even with value', () => {
    render(<Input showClearIcon value="test" disabled />)
    const clearIcon = document.querySelector('.group svg')
    expect(clearIcon).not.toBeInTheDocument()
  })

  it('calls onClear when clear icon is clicked', () => {
    const onClear = jest.fn()
    render(<Input showClearIcon value="test" onClear={onClear} />)
    const clearIconContainer = document.querySelector('.group')
    fireEvent.click(clearIconContainer!)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows warning icon when destructive is true', () => {
    render(<Input destructive />)
    const warningIcon = document.querySelector('svg')
    expect(warningIcon).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Please input')
    expect(input).toHaveClass('border-components-input-border-destructive')
  })

  it('applies disabled styles when disabled', () => {
    render(<Input disabled />)
    const input = screen.getByPlaceholderText('Please input')
    expect(input).toBeDisabled()
    expect(input).toHaveClass('cursor-not-allowed')
    expect(input).toHaveClass('bg-components-input-bg-disabled')
  })

  it('displays custom unit when provided', () => {
    render(<Input unit="km" />)
    const unitElement = screen.getByText('km')
    expect(unitElement).toBeInTheDocument()
  })

  it('applies custom className and style', () => {
    const customClass = 'test-class'
    const customStyle = { color: 'red' }
    render(<Input className={customClass} styleCss={customStyle} />)
    const input = screen.getByPlaceholderText('Please input')
    expect(input).toHaveClass(customClass)
    expect(input).toHaveStyle('color: red')
  })

  it('applies large size variant correctly', () => {
    render(<Input size={'large' as any} />)
    const input = screen.getByPlaceholderText('Please input')
    expect(input.className).toContain(inputVariants({ size: 'large' }))
  })

  it('uses custom placeholder when provided', () => {
    const placeholder = 'Custom placeholder'
    render(<Input placeholder={placeholder} />)
    const input = screen.getByPlaceholderText(placeholder)
    expect(input).toBeInTheDocument()
  })
})
