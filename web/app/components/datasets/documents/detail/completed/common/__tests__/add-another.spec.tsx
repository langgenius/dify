import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddAnother from '../add-another'

describe('AddAnother', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getCheckbox = () => screen.getByRole('checkbox', { name: /segment\.addAnother/i })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <AddAnother checked={false} onCheckedChange={vi.fn()} />,
      )

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the checkbox', () => {
      render(
        <AddAnother checked={false} onCheckedChange={vi.fn()} />,
      )

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should render the add another text', () => {
      render(<AddAnother checked={false} onCheckedChange={vi.fn()} />)

      // Assert - i18n key format
      expect(screen.getByText(/segment\.addAnother/i)).toBeInTheDocument()
    })

    it('should render with correct base styling classes', () => {
      const { container } = render(
        <AddAnother checked={false} onCheckedChange={vi.fn()} />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('gap-x-1')
      expect(wrapper).toHaveClass('pl-1')
    })
  })

  describe('Props', () => {
    it('should render unchecked state when checked is false', () => {
      render(
        <AddAnother checked={false} onCheckedChange={vi.fn()} />,
      )

      expect(getCheckbox()).toHaveAttribute('aria-checked', 'false')
    })

    it('should render checked state when checked is true', () => {
      render(
        <AddAnother checked={true} onCheckedChange={vi.fn()} />,
      )

      expect(getCheckbox()).toHaveAttribute('aria-checked', 'true')
    })

    it('should apply custom className', () => {
      const { container } = render(
        <AddAnother
          checked={false}
          onCheckedChange={vi.fn()}
          className="custom-class"
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  describe('User Interactions', () => {
    it('should call mockOnCheckedChange when checkbox is clicked', async () => {
      const mockOnCheckedChange = vi.fn()
      const user = userEvent.setup()
      render(
        <AddAnother checked={false} onCheckedChange={mockOnCheckedChange} />,
      )

      await user.click(screen.getByText(/segment\.addAnother/i))

      expect(mockOnCheckedChange).toHaveBeenCalledTimes(1)
    })

    it('should toggle checked state on multiple clicks', async () => {
      const mockOnCheckedChange = vi.fn()
      const user = userEvent.setup()
      const { rerender } = render(
        <AddAnother checked={false} onCheckedChange={mockOnCheckedChange} />,
      )

      await user.click(screen.getByText(/segment\.addAnother/i))
      rerender(<AddAnother checked={true} onCheckedChange={mockOnCheckedChange} />)
      await user.click(screen.getByText(/segment\.addAnother/i))

      expect(mockOnCheckedChange).toHaveBeenCalledTimes(2)
    })
  })

  describe('Structure', () => {
    it('should render text with tertiary text color', () => {
      const { container } = render(
        <AddAnother checked={false} onCheckedChange={vi.fn()} />,
      )

      const textElement = container.querySelector('.text-text-tertiary')
      expect(textElement).toBeInTheDocument()
    })

    it('should render text with xs medium font styling', () => {
      const { container } = render(
        <AddAnother checked={false} onCheckedChange={vi.fn()} />,
      )

      const textElement = container.querySelector('.system-xs-medium')
      expect(textElement).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      const mockOnCheckedChange = vi.fn()
      const { rerender } = render(
        <AddAnother checked={false} onCheckedChange={mockOnCheckedChange} />,
      )

      rerender(<AddAnother checked={true} onCheckedChange={mockOnCheckedChange} />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should handle rapid state changes', async () => {
      const mockOnCheckedChange = vi.fn()
      const user = userEvent.setup()
      render(
        <AddAnother checked={false} onCheckedChange={mockOnCheckedChange} />,
      )

      for (let i = 0; i < 5; i++)
        await user.click(screen.getByText(/segment\.addAnother/i))

      expect(mockOnCheckedChange).toHaveBeenCalledTimes(5)
    })
  })
})
