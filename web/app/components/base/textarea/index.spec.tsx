import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TextArea from './index'

describe('TextArea', () => {
  it('should render correctly with default props', () => {
    render(<TextArea value="" onChange={vi.fn()} />)
    const textarea = screen.getByTestId('text-area')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue('')
  })

  it('should handle value and onChange correctly', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    const { rerender } = render(<TextArea value="initial" onChange={handleChange} />)
    const textarea = screen.getByTestId('text-area')
    expect(textarea).toHaveValue('initial')

    await user.type(textarea, ' updated')
    expect(handleChange).toHaveBeenCalled()

    rerender(<TextArea value="initial updated" onChange={handleChange} />)
    expect(textarea).toHaveValue('initial updated')
  })

  it('should handle autoFocus correctly', () => {
    render(<TextArea value="" onChange={vi.fn()} autoFocus />)
    const textarea = screen.getByTestId('text-area')
    expect(textarea).toHaveFocus()
  })

  it('should handle disabled state', () => {
    render(<TextArea value="" onChange={vi.fn()} disabled />)
    const textarea = screen.getByTestId('text-area')
    expect(textarea).toBeDisabled()
    expect(textarea).toHaveClass('cursor-not-allowed')
  })

  it('should handle placeholder', () => {
    render(<TextArea value="" onChange={vi.fn()} placeholder="Enter text here" />)
    expect(screen.getByPlaceholderText('Enter text here')).toBeInTheDocument()
  })

  it('should handle className', () => {
    render(<TextArea value="" onChange={vi.fn()} className="custom-class" />)
    expect(screen.getByTestId('text-area')).toHaveClass('custom-class')
  })

  it('should handle size variants', () => {
    const { rerender } = render(<TextArea value="" onChange={vi.fn()} size="small" />)
    expect(screen.getByTestId('text-area')).toHaveClass('py-1')

    rerender(<TextArea value="" onChange={vi.fn()} size="large" />)
    expect(screen.getByTestId('text-area')).toHaveClass('px-4')
  })

  it('should handle destructive state', () => {
    render(<TextArea value="" onChange={vi.fn()} destructive />)
    expect(screen.getByTestId('text-area')).toHaveClass('border-components-input-border-destructive')
  })

  it('should handle onFocus and onBlur', async () => {
    const user = userEvent.setup()
    const handleFocus = vi.fn()
    const handleBlur = vi.fn()
    render(<TextArea value="" onChange={vi.fn()} onFocus={handleFocus} onBlur={handleBlur} />)
    const textarea = screen.getByTestId('text-area')

    await user.click(textarea)
    expect(handleFocus).toHaveBeenCalled()

    await user.tab()
    expect(handleBlur).toHaveBeenCalled()
  })
})
