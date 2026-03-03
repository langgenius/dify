import type { Placement } from '@/app/components/base/ui/placement'
import { Menu } from '@base-ui/react/menu'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../index'

vi.mock('@base-ui/react/menu', async () => {
  const React = await import('react')

  type PrimitiveProps = React.HTMLAttributes<HTMLDivElement> & {
    children?: React.ReactNode
  }

  type PrimitiveOptions = {
    displayName: string
    defaultRole?: React.AriaRole
  }

  type PositionerProps = PrimitiveProps & {
    side?: string
    align?: string
    sideOffset?: number
    alignOffset?: number
  }

  const createPrimitive = ({ displayName, defaultRole }: PrimitiveOptions) => {
    const Primitive = React.forwardRef<HTMLDivElement, PrimitiveProps>(({ children, role, ...props }, ref) => {
      return React.createElement(
        'div',
        {
          ref,
          role: role ?? defaultRole,
          ...props,
        },
        children,
      )
    })
    Primitive.displayName = displayName
    return Primitive
  }

  const Portal = ({ children }: PrimitiveProps) => {
    return React.createElement(React.Fragment, null, children)
  }
  Portal.displayName = 'menu-portal'

  const Positioner = React.forwardRef<HTMLDivElement, PositionerProps>(({ children, role, side, align, sideOffset, alignOffset, ...props }, ref) => {
    return React.createElement(
      'div',
      {
        ref,
        'role': role ?? 'group',
        'data-side': side,
        'data-align': align,
        'data-side-offset': sideOffset,
        'data-align-offset': alignOffset,
        ...props,
      },
      children,
    )
  })
  Positioner.displayName = 'menu-positioner'

  const Menu = {
    Root: createPrimitive({ displayName: 'menu-root' }),
    Portal,
    Trigger: createPrimitive({ displayName: 'menu-trigger', defaultRole: 'button' }),
    SubmenuRoot: createPrimitive({ displayName: 'menu-submenu-root' }),
    Group: createPrimitive({ displayName: 'menu-group', defaultRole: 'group' }),
    GroupLabel: createPrimitive({ displayName: 'menu-group-label' }),
    RadioGroup: createPrimitive({ displayName: 'menu-radio-group', defaultRole: 'radiogroup' }),
    RadioItem: createPrimitive({ displayName: 'menu-radio-item', defaultRole: 'menuitemradio' }),
    RadioItemIndicator: createPrimitive({ displayName: 'menu-radio-item-indicator' }),
    CheckboxItem: createPrimitive({ displayName: 'menu-checkbox-item', defaultRole: 'menuitemcheckbox' }),
    CheckboxItemIndicator: createPrimitive({ displayName: 'menu-checkbox-item-indicator' }),
    Positioner,
    Popup: createPrimitive({ displayName: 'menu-popup', defaultRole: 'menu' }),
    SubmenuTrigger: createPrimitive({ displayName: 'menu-submenu-trigger', defaultRole: 'menuitem' }),
    Item: createPrimitive({ displayName: 'menu-item', defaultRole: 'menuitem' }),
    Separator: createPrimitive({ displayName: 'menu-separator', defaultRole: 'separator' }),
  }

  return { Menu }
})

vi.mock('@/app/components/base/ui/placement', () => ({
  parsePlacement: vi.fn((placement: Placement) => {
    const [side, align] = placement.split('-') as [string, string | undefined]
    return {
      side: side as 'top' | 'right' | 'bottom' | 'left',
      align: (align ?? 'center') as 'start' | 'center' | 'end',
    }
  }),
}))

describe('dropdown-menu wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Ensures exported aliases stay aligned with the wrapped Menu primitives.
  describe('alias exports', () => {
    it('should map direct aliases to the corresponding Menu primitive when importing menu roots', () => {
      // Arrange

      // Act

      // Assert
      expect(DropdownMenu).toBe(Menu.Root)
      expect(DropdownMenuPortal).toBe(Menu.Portal)
      expect(DropdownMenuTrigger).toBe(Menu.Trigger)
      expect(DropdownMenuSub).toBe(Menu.SubmenuRoot)
      expect(DropdownMenuGroup).toBe(Menu.Group)
      expect(DropdownMenuRadioGroup).toBe(Menu.RadioGroup)
    })
  })

  // Verifies content popup placement and passthrough behavior.
  describe('DropdownMenuContent', () => {
    it('should position content at bottom-end with default offsets when placement props are omitted', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)

      // Act
      render(
        <DropdownMenuContent>
          <button type="button">content action</button>
        </DropdownMenuContent>,
      )

      // Assert
      const popup = screen.getByRole('menu')
      const positioner = popup.parentElement

      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('bottom-end')
      expect(positioner).not.toBeNull()
      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('data-side-offset', '4')
      expect(positioner).toHaveAttribute('data-align-offset', '0')
      expect(within(popup).getByRole('button', { name: 'content action' })).toBeInTheDocument()
    })

    it('should apply custom placement offsets when custom positioning props are provided', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)

      // Act
      render(
        <DropdownMenuContent
          placement="top-start"
          sideOffset={12}
          alignOffset={-3}
        >
          <span>custom content</span>
        </DropdownMenuContent>,
      )

      // Assert
      const popup = screen.getByRole('menu')
      const positioner = popup.parentElement

      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('top-start')
      expect(positioner).not.toBeNull()
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(positioner).toHaveAttribute('data-side-offset', '12')
      expect(positioner).toHaveAttribute('data-align-offset', '-3')
      expect(within(popup).getByText('custom content')).toBeInTheDocument()
    })

    it('should forward passthrough attributes and handlers when positionerProps and popupProps are provided', () => {
      // Arrange
      const handlePositionerMouseEnter = vi.fn()
      const handlePopupClick = vi.fn()

      // Act
      render(
        <DropdownMenuContent
          positionerProps={{
            'aria-label': 'dropdown content positioner',
            'id': 'dropdown-content-positioner',
            'onMouseEnter': handlePositionerMouseEnter,
          }}
          popupProps={{
            'aria-label': 'dropdown content popup',
            'id': 'dropdown-content-popup',
            'onClick': handlePopupClick,
          }}
        >
          <span>passthrough content</span>
        </DropdownMenuContent>,
      )

      // Assert
      const positioner = screen.getByRole('group', { name: 'dropdown content positioner' })
      const popup = screen.getByRole('menu', { name: 'dropdown content popup' })
      fireEvent.mouseEnter(positioner)
      fireEvent.click(popup)

      expect(positioner).toHaveAttribute('id', 'dropdown-content-positioner')
      expect(popup).toHaveAttribute('id', 'dropdown-content-popup')
      expect(handlePositionerMouseEnter).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  // Verifies submenu popup placement and passthrough behavior.
  describe('DropdownMenuSubContent', () => {
    it('should position sub-content at left-start with default offsets when props are omitted', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)

      // Act
      render(
        <DropdownMenuSubContent>
          <button type="button">sub action</button>
        </DropdownMenuSubContent>,
      )

      // Assert
      const popup = screen.getByRole('menu')
      const positioner = popup.parentElement

      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('left-start')
      expect(positioner).not.toBeNull()
      expect(positioner).toHaveAttribute('data-side', 'left')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(positioner).toHaveAttribute('data-side-offset', '4')
      expect(positioner).toHaveAttribute('data-align-offset', '0')
      expect(within(popup).getByRole('button', { name: 'sub action' })).toBeInTheDocument()
    })

    it('should apply custom placement offsets and forward passthrough props when custom sub-content props are provided', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)
      const handlePositionerFocus = vi.fn()
      const handlePopupClick = vi.fn()

      // Act
      render(
        <DropdownMenuSubContent
          placement="right-end"
          sideOffset={6}
          alignOffset={2}
          positionerProps={{
            'aria-label': 'dropdown sub positioner',
            'id': 'dropdown-sub-positioner',
            'onFocus': handlePositionerFocus,
          }}
          popupProps={{
            'aria-label': 'dropdown sub popup',
            'id': 'dropdown-sub-popup',
            'onClick': handlePopupClick,
          }}
        >
          <span>custom sub content</span>
        </DropdownMenuSubContent>,
      )

      // Assert
      const positioner = screen.getByRole('group', { name: 'dropdown sub positioner' })
      const popup = screen.getByRole('menu', { name: 'dropdown sub popup' })
      fireEvent.focus(positioner)
      fireEvent.click(popup)

      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('right-end')
      expect(positioner).toHaveAttribute('data-side', 'right')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('data-side-offset', '6')
      expect(positioner).toHaveAttribute('data-align-offset', '2')
      expect(positioner).toHaveAttribute('id', 'dropdown-sub-positioner')
      expect(popup).toHaveAttribute('id', 'dropdown-sub-popup')
      expect(handlePositionerFocus).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  // Covers submenu trigger behavior with and without destructive flag.
  describe('DropdownMenuSubTrigger', () => {
    it('should render label and submenu chevron when trigger children are provided', () => {
      // Arrange

      // Act
      render(
        <DropdownMenuSubTrigger>
          Trigger item
        </DropdownMenuSubTrigger>,
      )

      // Assert
      const subTrigger = screen.getByRole('menuitem', { name: 'Trigger item' })
      expect(subTrigger.querySelector('span[aria-hidden="true"]')).not.toBeNull()
    })

    it.each([true, false])('should remain interactive and not leak destructive prop when destructive is %s', (destructive) => {
      // Arrange
      const handleClick = vi.fn()

      // Act
      render(
        <DropdownMenuSubTrigger
          destructive={destructive}
          aria-label="submenu action"
          id={`submenu-trigger-${String(destructive)}`}
          onClick={handleClick}
        >
          Trigger item
        </DropdownMenuSubTrigger>,
      )

      // Assert
      const subTrigger = screen.getByRole('menuitem', { name: 'submenu action' })
      fireEvent.click(subTrigger)

      expect(subTrigger).toHaveAttribute('id', `submenu-trigger-${String(destructive)}`)
      expect(subTrigger).not.toHaveAttribute('destructive')
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  // Covers menu item behavior with and without destructive flag.
  describe('DropdownMenuItem', () => {
    it.each([true, false])('should remain interactive and not leak destructive prop when destructive is %s', (destructive) => {
      // Arrange
      const handleClick = vi.fn()

      // Act
      render(
        <DropdownMenuItem
          destructive={destructive}
          aria-label="menu action"
          id={`menu-item-${String(destructive)}`}
          onClick={handleClick}
        >
          Item label
        </DropdownMenuItem>,
      )

      // Assert
      const item = screen.getByRole('menuitem', { name: 'menu action' })
      fireEvent.click(item)

      expect(item).toHaveAttribute('id', `menu-item-${String(destructive)}`)
      expect(item).not.toHaveAttribute('destructive')
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  // Verifies separator semantics and row separation behavior.
  describe('DropdownMenuSeparator', () => {
    it('should forward passthrough props and handlers when separator props are provided', () => {
      // Arrange
      const handleMouseEnter = vi.fn()

      // Act
      render(
        <DropdownMenuSeparator
          aria-label="actions divider"
          id="menu-separator"
          onMouseEnter={handleMouseEnter}
        />,
      )

      // Assert
      const separator = screen.getByRole('separator', { name: 'actions divider' })
      fireEvent.mouseEnter(separator)

      expect(separator).toHaveAttribute('id', 'menu-separator')
      expect(handleMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('should keep surrounding menu rows rendered when separator is placed between items', () => {
      // Arrange

      // Act
      render(
        <>
          <DropdownMenuItem>First action</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Second action</DropdownMenuItem>
        </>,
      )

      // Assert
      expect(screen.getByRole('menuitem', { name: 'First action' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Second action' })).toBeInTheDocument()
      expect(screen.getAllByRole('separator')).toHaveLength(1)
    })
  })
})
