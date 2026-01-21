import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Field from './field'

describe('Field', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Field label="Test Label">Content</Field>)
      expect(screen.getByText('Test Label')).toBeInTheDocument()
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('should render label with correct styling', () => {
      render(<Field label="My Label">Content</Field>)
      const labelElement = screen.getByText('My Label')
      expect(labelElement).toHaveClass('system-xs-medium', 'w-[128px]', 'shrink-0', 'truncate', 'py-1', 'text-text-tertiary')
    })

    it('should render children in correct container', () => {
      const { container } = render(<Field label="Label">Child Content</Field>)
      // The children are wrapped in a div with w-[244px] class
      const contentWrapper = container.querySelector('.w-\\[244px\\]')
      expect(contentWrapper).toBeInTheDocument()
      expect(contentWrapper).toHaveClass('shrink-0')
    })
  })

  describe('Props', () => {
    it('should render with string children', () => {
      render(<Field label="Label">Simple Text</Field>)
      expect(screen.getByText('Simple Text')).toBeInTheDocument()
    })

    it('should render with complex children', () => {
      render(
        <Field label="Label">
          <div data-testid="complex-child">
            <span>Nested Content</span>
          </div>
        </Field>,
      )
      expect(screen.getByTestId('complex-child')).toBeInTheDocument()
      expect(screen.getByText('Nested Content')).toBeInTheDocument()
    })

    it('should render with multiple children', () => {
      render(
        <Field label="Label">
          <span>First</span>
          <span>Second</span>
        </Field>,
      )
      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
    })

    it('should render different labels correctly', () => {
      const { rerender } = render(<Field label="First Label">Content</Field>)
      expect(screen.getByText('First Label')).toBeInTheDocument()

      rerender(<Field label="Second Label">Content</Field>)
      expect(screen.getByText('Second Label')).toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('should have flex layout with space between elements', () => {
      const { container } = render(<Field label="Label">Content</Field>)
      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('flex', 'items-start', 'space-x-2')
    })

    it('should render label and content side by side', () => {
      const { container } = render(<Field label="Label">Content</Field>)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper?.children).toHaveLength(2)
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty label', () => {
      render(<Field label="">Content</Field>)
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('should render with long label (truncation)', () => {
      const longLabel = 'This is a very long label that should be truncated'
      render(<Field label={longLabel}>Content</Field>)
      const labelElement = screen.getByText(longLabel)
      expect(labelElement).toHaveClass('truncate')
    })

    it('should render with empty children', () => {
      const { container } = render(<Field label="Label"><span></span></Field>)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with null children', () => {
      const { container } = render(<Field label="Label">{null}</Field>)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with number as children', () => {
      render(<Field label="Label">{42}</Field>)
      expect(screen.getByText('42')).toBeInTheDocument()
    })

    it('should handle special characters in label', () => {
      render(<Field label={'Label & "chars"'}>Content</Field>)
      expect(screen.getByText('Label & "chars"')).toBeInTheDocument()
    })
  })
})
