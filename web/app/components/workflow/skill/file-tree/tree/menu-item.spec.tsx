import type { MenuItemProps } from './menu-item'
import { fireEvent, render, screen } from '@testing-library/react'
import MenuItem from './menu-item'

const MockIcon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />

const defaultProps: MenuItemProps = {
  icon: MockIcon,
  label: 'Rename',
  onClick: vi.fn(),
}

const renderMenuItem = (overrides: Partial<MenuItemProps> = {}) => {
  const props = { ...defaultProps, ...overrides }
  return {
    ...render(<MenuItem {...props} />),
    onClick: props.onClick,
  }
}

describe('MenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Menu item should render its interactive label and style variants.
  describe('Rendering', () => {
    it('should render a button with the provided label', () => {
      // Arrange
      renderMenuItem()

      // Assert
      expect(screen.getByRole('button', { name: /rename/i })).toBeInTheDocument()
    })

    it('should apply destructive variant styles when variant is destructive', () => {
      // Arrange
      renderMenuItem({ variant: 'destructive', label: 'Delete' })

      // Act
      const button = screen.getByRole('button', { name: /delete/i })

      // Assert
      expect(button).toHaveClass('group')
      expect(button).toHaveClass('hover:bg-state-destructive-hover')
    })
  })

  // Optional props should alter the visible content.
  describe('Props', () => {
    it('should render keyboard shortcut hints when kbd has values', () => {
      // Arrange
      renderMenuItem({ kbd: ['k'] })

      // Assert
      expect(screen.getByText('k')).toBeInTheDocument()
    })

    it('should not render keyboard shortcut hints when kbd is empty', () => {
      // Arrange
      renderMenuItem({ kbd: [] })

      // Assert
      expect(screen.queryByText('k')).not.toBeInTheDocument()
    })

    it('should show tooltip content when hovering the tooltip trigger', async () => {
      // Arrange
      const tooltipText = 'Show help'
      const { container } = renderMenuItem({ tooltip: tooltipText })
      const tooltipIcon = container.querySelector('svg.text-text-quaternary')

      // Act
      expect(tooltipIcon).toBeTruthy()
      fireEvent.mouseEnter(tooltipIcon!)

      // Assert
      expect(await screen.findByText(tooltipText)).toBeInTheDocument()
    })
  })

  // Click handling should call actions without leaking events upward.
  describe('Interactions', () => {
    it('should call onClick and stop click propagation when button is clicked', () => {
      // Arrange
      const outerClick = vi.fn()
      const onClick = vi.fn()
      render(
        <div onClick={outerClick}>
          <MenuItem {...defaultProps} onClick={onClick} />
        </div>,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: /rename/i }))

      // Assert
      expect(onClick).toHaveBeenCalledTimes(1)
      expect(outerClick).not.toHaveBeenCalled()
    })

    it('should not trigger onClick when tooltip icon is clicked', () => {
      // Arrange
      const onClick = vi.fn()
      const { container } = renderMenuItem({ onClick, tooltip: 'Help' })
      const tooltipIcon = container.querySelector('svg.text-text-quaternary')

      // Act
      expect(tooltipIcon).toBeTruthy()
      fireEvent.click(tooltipIcon!)

      // Assert
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  // Disabled state should block interaction.
  describe('Edge cases', () => {
    it('should disable the button and ignore click when disabled is true', () => {
      // Arrange
      const onClick = vi.fn()
      renderMenuItem({ onClick, disabled: true })
      const button = screen.getByRole('button', { name: /rename/i })

      // Act
      fireEvent.click(button)

      // Assert
      expect(button).toBeDisabled()
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
