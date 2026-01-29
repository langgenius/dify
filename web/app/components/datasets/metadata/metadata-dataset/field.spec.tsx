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
      expect(labelElement).toHaveClass('system-sm-semibold', 'py-1', 'text-text-secondary')
    })

    it('should render children in content container', () => {
      const { container } = render(<Field label="Label">Child Content</Field>)
      // The children wrapper has mt-1 class
      const contentWrapper = container.querySelector('.mt-1')
      expect(contentWrapper).toBeInTheDocument()
      expect(contentWrapper).toHaveTextContent('Child Content')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<Field label="Label" className="custom-class">Content</Field>)
      expect(container.firstChild).toHaveClass('custom-class')
    })

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
    it('should have label above content', () => {
      const { container } = render(<Field label="Label">Content</Field>)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper?.children).toHaveLength(2)
    })

    it('should render label element first', () => {
      const { container } = render(<Field label="Label">Content</Field>)
      const wrapper = container.firstChild as HTMLElement
      const firstChild = wrapper?.firstChild as HTMLElement
      expect(firstChild).toHaveClass('system-sm-semibold')
    })
  })

  describe('Edge Cases', () => {
    it('should render with undefined className', () => {
      render(<Field label="Label" className={undefined}>Content</Field>)
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('should render with empty className', () => {
      render(<Field label="Label" className="">Content</Field>)
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('should render with empty label', () => {
      render(<Field label="">Content</Field>)
      expect(screen.getByText('Content')).toBeInTheDocument()
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
