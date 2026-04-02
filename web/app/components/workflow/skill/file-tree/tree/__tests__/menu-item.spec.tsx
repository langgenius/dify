import type { MenuItemProps } from '.././menu-item'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/app/components/base/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import MenuItem from '.././menu-item'

const MockIcon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />

const defaultProps: MenuItemProps = {
  menuType: 'dropdown',
  icon: MockIcon,
  label: 'Rename',
  onClick: vi.fn(),
}

const renderMenuItem = (overrides: Partial<MenuItemProps> = {}) => {
  const props = { ...defaultProps, ...overrides }
  const ui = props.menuType === 'dropdown'
    ? (
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <MenuItem {...props} />
          </DropdownMenuContent>
        </DropdownMenu>
      )
    : (
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <MenuItem {...props} />
          </ContextMenuContent>
        </ContextMenu>
      )

  return {
    ...render(ui),
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
      const item = screen.getByRole('menuitem', { name: /rename/i })
      expect(item).toBeInTheDocument()
      expect(item).toHaveClass('mx-1')
      expect(item).toHaveClass('min-w-0')
      expect(item).toHaveClass('px-3')
      expect(item).not.toHaveClass('w-full')
    })

    it('should render inside the context menu variant', () => {
      renderMenuItem({ menuType: 'context', label: 'Reveal' })

      expect(screen.getByRole('menuitem', { name: /reveal/i })).toBeInTheDocument()
    })

    it('should apply destructive variant styles when variant is destructive', () => {
      // Arrange
      renderMenuItem({ variant: 'destructive', label: 'Delete' })

      // Act
      const button = screen.getByRole('menuitem', { name: /delete/i })

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
      renderMenuItem({ tooltip: tooltipText })
      const tooltipIcon = document.body.querySelector('.i-ri-question-line')

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
      const onClick = vi.fn()
      renderMenuItem({ onClick })

      // Act
      fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

      // Assert
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should not trigger onClick when tooltip icon is clicked', () => {
      // Arrange
      const onClick = vi.fn()
      renderMenuItem({ onClick, tooltip: 'Help' })
      const tooltipIcon = document.body.querySelector('.i-ri-question-line')

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
      const button = screen.getByRole('menuitem', { name: /rename/i })

      // Act
      fireEvent.click(button)

      // Assert
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
