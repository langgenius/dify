import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Textarea from '../textarea'

describe('Textarea', () => {
  const mockHandleTextChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the textarea with character count
  describe('Rendering', () => {
    it('should render a textarea element', () => {
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should display the current text', () => {
      render(<Textarea text="Hello world" handleTextChange={mockHandleTextChange} />)

      expect(screen.getByRole('textbox')).toHaveValue('Hello world')
    })

    it('should show character count', () => {
      render(<Textarea text="Hello" handleTextChange={mockHandleTextChange} />)

      expect(screen.getByText('5/200')).toBeInTheDocument()
    })

    it('should show 0/200 for empty text', () => {
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      expect(screen.getByText('0/200')).toBeInTheDocument()
    })

    it('should render placeholder text', () => {
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder')
    })
  })

  // Warning state tests for exceeding character limit
  describe('Warning state (>200 chars)', () => {
    it('should apply warning border when text exceeds 200 characters', () => {
      const longText = 'A'.repeat(201)

      const { container } = render(
        <Textarea text={longText} handleTextChange={mockHandleTextChange} />,
      )

      const wrapper = container.firstElementChild
      expect(wrapper?.className).toContain('border-state-destructive-active')
    })

    it('should not apply warning border when text is at 200 characters', () => {
      const text200 = 'A'.repeat(200)

      const { container } = render(
        <Textarea text={text200} handleTextChange={mockHandleTextChange} />,
      )

      const wrapper = container.firstElementChild
      expect(wrapper?.className).not.toContain('border-state-destructive-active')
    })

    it('should not apply warning border when text is under 200 characters', () => {
      const { container } = render(
        <Textarea text="Short text" handleTextChange={mockHandleTextChange} />,
      )

      const wrapper = container.firstElementChild
      expect(wrapper?.className).not.toContain('border-state-destructive-active')
    })

    it('should show warning count with red styling when over 200 chars', () => {
      const longText = 'B'.repeat(250)

      render(<Textarea text={longText} handleTextChange={mockHandleTextChange} />)

      const countElement = screen.getByText('250/200')
      expect(countElement.className).toContain('text-util-colors-red-red-600')
    })

    it('should show normal count styling when at or under 200 chars', () => {
      render(<Textarea text="Short" handleTextChange={mockHandleTextChange} />)

      const countElement = screen.getByText('5/200')
      expect(countElement.className).toContain('text-text-tertiary')
    })

    it('should show red corner icon when over 200 chars', () => {
      const longText = 'C'.repeat(201)

      const { container } = render(
        <Textarea text={longText} handleTextChange={mockHandleTextChange} />,
      )

      // Assert - Corner icon should have red class
      const cornerWrapper = container.querySelector('.right-0.top-0')
      const cornerSvg = cornerWrapper?.querySelector('svg')
      expect(cornerSvg?.className.baseVal || cornerSvg?.getAttribute('class')).toContain('text-util-colors-red-red-100')
    })
  })

  // User interaction tests
  describe('User Interactions', () => {
    it('should call handleTextChange when text is entered', () => {
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'New text' },
      })

      expect(mockHandleTextChange).toHaveBeenCalledTimes(1)
    })
  })
})
