import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Label from './label'

describe('Label', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Label text="Test Label" />)
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render text with correct styling', () => {
      render(<Label text="My Label" />)
      const labelElement = screen.getByText('My Label')
      expect(labelElement).toHaveClass('system-xs-medium', 'w-[136px]', 'shrink-0', 'truncate', 'text-text-tertiary')
    })

    it('should not have deleted styling by default', () => {
      render(<Label text="Label" />)
      const labelElement = screen.getByText('Label')
      expect(labelElement).not.toHaveClass('text-text-quaternary', 'line-through')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      render(<Label text="Label" className="custom-class" />)
      const labelElement = screen.getByText('Label')
      expect(labelElement).toHaveClass('custom-class')
    })

    it('should merge custom className with default classes', () => {
      render(<Label text="Label" className="my-custom-class" />)
      const labelElement = screen.getByText('Label')
      expect(labelElement).toHaveClass('system-xs-medium', 'my-custom-class')
    })

    it('should apply deleted styling when isDeleted is true', () => {
      render(<Label text="Label" isDeleted />)
      const labelElement = screen.getByText('Label')
      expect(labelElement).toHaveClass('text-text-quaternary', 'line-through')
    })

    it('should not apply deleted styling when isDeleted is false', () => {
      render(<Label text="Label" isDeleted={false} />)
      const labelElement = screen.getByText('Label')
      expect(labelElement).not.toHaveClass('text-text-quaternary', 'line-through')
    })

    it('should render different text values', () => {
      const { rerender } = render(<Label text="First" />)
      expect(screen.getByText('First')).toBeInTheDocument()

      rerender(<Label text="Second" />)
      expect(screen.getByText('Second')).toBeInTheDocument()
    })
  })

  describe('Deleted State', () => {
    it('should have strikethrough when deleted', () => {
      render(<Label text="Deleted Label" isDeleted />)
      const labelElement = screen.getByText('Deleted Label')
      expect(labelElement).toHaveClass('line-through')
    })

    it('should have quaternary text color when deleted', () => {
      render(<Label text="Deleted Label" isDeleted />)
      const labelElement = screen.getByText('Deleted Label')
      expect(labelElement).toHaveClass('text-text-quaternary')
    })

    it('should combine deleted styling with custom className', () => {
      render(<Label text="Label" isDeleted className="custom" />)
      const labelElement = screen.getByText('Label')
      expect(labelElement).toHaveClass('line-through', 'custom')
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty text', () => {
      const { container } = render(<Label text="" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with long text (truncation)', () => {
      const longText = 'This is a very long label text that should be truncated'
      render(<Label text={longText} />)
      const labelElement = screen.getByText(longText)
      expect(labelElement).toHaveClass('truncate')
    })

    it('should render with undefined className', () => {
      render(<Label text="Label" className={undefined} />)
      expect(screen.getByText('Label')).toBeInTheDocument()
    })

    it('should render with undefined isDeleted', () => {
      render(<Label text="Label" isDeleted={undefined} />)
      const labelElement = screen.getByText('Label')
      expect(labelElement).not.toHaveClass('line-through')
    })

    it('should handle special characters in text', () => {
      render(<Label text={'Label & "chars"'} />)
      expect(screen.getByText('Label & "chars"')).toBeInTheDocument()
    })

    it('should handle numbers in text', () => {
      render(<Label text="Label 123" />)
      expect(screen.getByText('Label 123')).toBeInTheDocument()
    })
  })
})
