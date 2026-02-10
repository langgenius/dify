import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Textarea from './textarea'

describe('Textarea', () => {
  const mockHandleTextChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the textarea with character count
  describe('Rendering', () => {
    it('should render a textarea element', () => {
      // Arrange & Act
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should display the current text', () => {
      // Arrange & Act
      render(<Textarea text="Hello world" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByRole('textbox')).toHaveValue('Hello world')
    })

    it('should show character count', () => {
      // Arrange & Act
      render(<Textarea text="Hello" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByText('5/200')).toBeInTheDocument()
    })

    it('should show 0/200 for empty text', () => {
      // Arrange & Act
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByText('0/200')).toBeInTheDocument()
    })

    it('should render placeholder text', () => {
      // Arrange & Act
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder')
    })
  })

  // Warning state tests for exceeding character limit
  describe('Warning state (>200 chars)', () => {
    it('should apply warning border when text exceeds 200 characters', () => {
      // Arrange
      const longText = 'A'.repeat(201)

      // Act
      const { container } = render(
        <Textarea text={longText} handleTextChange={mockHandleTextChange} />,
      )

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).toContain('border-state-destructive-active')
    })

    it('should not apply warning border when text is at 200 characters', () => {
      // Arrange
      const text200 = 'A'.repeat(200)

      // Act
      const { container } = render(
        <Textarea text={text200} handleTextChange={mockHandleTextChange} />,
      )

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).not.toContain('border-state-destructive-active')
    })

    it('should not apply warning border when text is under 200 characters', () => {
      // Arrange & Act
      const { container } = render(
        <Textarea text="Short text" handleTextChange={mockHandleTextChange} />,
      )

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).not.toContain('border-state-destructive-active')
    })

    it('should show warning count with red styling when over 200 chars', () => {
      // Arrange
      const longText = 'B'.repeat(250)

      // Act
      render(<Textarea text={longText} handleTextChange={mockHandleTextChange} />)

      // Assert
      const countElement = screen.getByText('250/200')
      expect(countElement.className).toContain('text-util-colors-red-red-600')
    })

    it('should show normal count styling when at or under 200 chars', () => {
      // Arrange & Act
      render(<Textarea text="Short" handleTextChange={mockHandleTextChange} />)

      // Assert
      const countElement = screen.getByText('5/200')
      expect(countElement.className).toContain('text-text-tertiary')
    })

    it('should show red corner icon when over 200 chars', () => {
      // Arrange
      const longText = 'C'.repeat(201)

      // Act
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
      // Arrange
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Act
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'New text' },
      })

      // Assert
      expect(mockHandleTextChange).toHaveBeenCalledTimes(1)
    })
  })
})
