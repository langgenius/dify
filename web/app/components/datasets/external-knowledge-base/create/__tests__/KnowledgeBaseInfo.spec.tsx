import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeBaseInfo from '../KnowledgeBaseInfo'

describe('KnowledgeBaseInfo', () => {
  const defaultProps = {
    name: '',
    description: '',
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verifies all form fields render
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<KnowledgeBaseInfo {...defaultProps} />)
      expect(screen.getByText(/externalKnowledgeName/)).toBeInTheDocument()
    })

    it('should render the name label', () => {
      render(<KnowledgeBaseInfo {...defaultProps} />)
      expect(screen.getByText(/externalKnowledgeName(?!Placeholder)/)).toBeInTheDocument()
    })

    it('should render the description label', () => {
      render(<KnowledgeBaseInfo {...defaultProps} />)
      expect(screen.getByText(/externalKnowledgeDescription(?!Placeholder)/)).toBeInTheDocument()
    })

    it('should render name input with placeholder', () => {
      render(<KnowledgeBaseInfo {...defaultProps} />)
      const input = screen.getByPlaceholderText(/externalKnowledgeNamePlaceholder/)
      expect(input).toBeInTheDocument()
    })

    it('should render description textarea with placeholder', () => {
      render(<KnowledgeBaseInfo {...defaultProps} />)
      const textarea = screen.getByPlaceholderText(/externalKnowledgeDescriptionPlaceholder/)
      expect(textarea).toBeInTheDocument()
    })
  })

  // Props: tests value display and onChange callbacks
  describe('Props', () => {
    it('should display name in the input', () => {
      render(<KnowledgeBaseInfo {...defaultProps} name="My Knowledge Base" />)
      const input = screen.getByDisplayValue('My Knowledge Base')
      expect(input).toBeInTheDocument()
    })

    it('should display description in the textarea', () => {
      render(<KnowledgeBaseInfo {...defaultProps} description="A description" />)
      const textarea = screen.getByDisplayValue('A description')
      expect(textarea).toBeInTheDocument()
    })

    it('should call onChange with name when name input changes', () => {
      const onChange = vi.fn()
      render(<KnowledgeBaseInfo {...defaultProps} onChange={onChange} />)
      const input = screen.getByPlaceholderText(/externalKnowledgeNamePlaceholder/)

      fireEvent.change(input, { target: { value: 'New Name' } })

      expect(onChange).toHaveBeenCalledWith({ name: 'New Name' })
    })

    it('should call onChange with description when textarea changes', () => {
      const onChange = vi.fn()
      render(<KnowledgeBaseInfo {...defaultProps} onChange={onChange} />)
      const textarea = screen.getByPlaceholderText(/externalKnowledgeDescriptionPlaceholder/)

      fireEvent.change(textarea, { target: { value: 'New Description' } })

      expect(onChange).toHaveBeenCalledWith({ description: 'New Description' })
    })
  })

  // User Interactions: tests form interactions
  describe('User Interactions', () => {
    it('should allow typing in name input', () => {
      const onChange = vi.fn()
      render(<KnowledgeBaseInfo {...defaultProps} onChange={onChange} />)
      const input = screen.getByPlaceholderText(/externalKnowledgeNamePlaceholder/)

      fireEvent.change(input, { target: { value: 'Typed Name' } })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith({ name: 'Typed Name' })
    })

    it('should allow typing in description textarea', () => {
      const onChange = vi.fn()
      render(<KnowledgeBaseInfo {...defaultProps} onChange={onChange} />)
      const textarea = screen.getByPlaceholderText(/externalKnowledgeDescriptionPlaceholder/)

      fireEvent.change(textarea, { target: { value: 'Typed Desc' } })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith({ description: 'Typed Desc' })
    })
  })

  // Edge Cases: tests boundary values
  describe('Edge Cases', () => {
    it('should handle empty name', () => {
      render(<KnowledgeBaseInfo {...defaultProps} name="" />)
      const input = screen.getByPlaceholderText(/externalKnowledgeNamePlaceholder/)
      expect(input).toHaveValue('')
    })

    it('should handle undefined description', () => {
      render(<KnowledgeBaseInfo {...defaultProps} description={undefined} />)
      const textarea = screen.getByPlaceholderText(/externalKnowledgeDescriptionPlaceholder/)
      expect(textarea).toBeInTheDocument()
    })

    it('should handle very long name', () => {
      const longName = 'K'.repeat(500)
      render(<KnowledgeBaseInfo {...defaultProps} name={longName} />)
      const input = screen.getByDisplayValue(longName)
      expect(input).toBeInTheDocument()
    })

    it('should handle very long description', () => {
      const longDesc = 'D'.repeat(2000)
      render(<KnowledgeBaseInfo {...defaultProps} description={longDesc} />)
      const textarea = screen.getByDisplayValue(longDesc)
      expect(textarea).toBeInTheDocument()
    })

    it('should handle special characters in name', () => {
      const specialName = 'Test & "quotes" <angle>'
      render(<KnowledgeBaseInfo {...defaultProps} name={specialName} />)
      const input = screen.getByDisplayValue(specialName)
      expect(input).toBeInTheDocument()
    })

    it('should apply filled text color class when description has content', () => {
      const { container } = render(<KnowledgeBaseInfo {...defaultProps} description="has content" />)
      const textarea = container.querySelector('textarea')
      expect(textarea).toHaveClass('text-components-input-text-filled')
    })

    it('should apply placeholder text color class when description is empty', () => {
      const { container } = render(<KnowledgeBaseInfo {...defaultProps} description="" />)
      const textarea = container.querySelector('textarea')
      expect(textarea).toHaveClass('text-components-input-text-placeholder')
    })
  })
})
