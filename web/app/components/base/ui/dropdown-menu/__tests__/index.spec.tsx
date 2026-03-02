import type { Placement } from '@floating-ui/react'
import { Menu } from '@base-ui/react/menu'
import { render, screen } from '@testing-library/react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
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

  type PositionerProps = PrimitiveProps & {
    side?: string
    align?: string
    sideOffset?: number
    alignOffset?: number
  }

  const createPrimitive = (testId: string) => {
    const Primitive = React.forwardRef<HTMLDivElement, PrimitiveProps>(({ children, ...props }, ref) => {
      return React.createElement('div', { ref, 'data-testid': testId, ...props }, children)
    })
    Primitive.displayName = testId
    return Primitive
  }

  const Positioner = React.forwardRef<HTMLDivElement, PositionerProps>(({ children, side, align, sideOffset, alignOffset, ...props }, ref) => {
    return React.createElement(
      'div',
      {
        ref,
        'data-testid': 'menu-positioner',
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
    Root: createPrimitive('menu-root'),
    Portal: createPrimitive('menu-portal'),
    Trigger: createPrimitive('menu-trigger'),
    SubmenuRoot: createPrimitive('menu-submenu-root'),
    Group: createPrimitive('menu-group'),
    GroupLabel: createPrimitive('menu-group-label'),
    RadioGroup: createPrimitive('menu-radio-group'),
    RadioItem: createPrimitive('menu-radio-item'),
    RadioItemIndicator: createPrimitive('menu-radio-item-indicator'),
    CheckboxItem: createPrimitive('menu-checkbox-item'),
    CheckboxItemIndicator: createPrimitive('menu-checkbox-item-indicator'),
    Positioner,
    Popup: createPrimitive('menu-popup'),
    SubmenuTrigger: createPrimitive('menu-submenu-trigger'),
    Item: createPrimitive('menu-item'),
    Separator: createPrimitive('menu-separator'),
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
    it('should map each alias export to the corresponding Menu primitive', () => {
      // Arrange

      // Act

      // Assert
      expect(DropdownMenu).toBe(Menu.Root)
      expect(DropdownMenuPortal).toBe(Menu.Portal)
      expect(DropdownMenuTrigger).toBe(Menu.Trigger)
      expect(DropdownMenuSub).toBe(Menu.SubmenuRoot)
      expect(DropdownMenuGroup).toBe(Menu.Group)
      expect(DropdownMenuGroupLabel).toBe(Menu.GroupLabel)
      expect(DropdownMenuRadioGroup).toBe(Menu.RadioGroup)
      expect(DropdownMenuRadioItem).toBe(Menu.RadioItem)
      expect(DropdownMenuRadioItemIndicator).toBe(Menu.RadioItemIndicator)
      expect(DropdownMenuCheckboxItem).toBe(Menu.CheckboxItem)
      expect(DropdownMenuCheckboxItemIndicator).toBe(Menu.CheckboxItemIndicator)
    })
  })

  describe('DropdownMenuContent', () => {
    it('should use default placement and offsets when props are omitted', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)

      // Act
      render(
        <DropdownMenuContent>
          <span>content child</span>
        </DropdownMenuContent>,
      )

      // Assert
      const positioner = screen.getByTestId('menu-positioner')
      const popup = screen.getByTestId('menu-popup')

      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('bottom-end')
      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('data-side-offset', '4')
      expect(positioner).toHaveAttribute('data-align-offset', '0')
      expect(positioner).toHaveClass('outline-none')
      expect(popup).toHaveClass('rounded-xl')
      expect(popup).toHaveClass('py-1')
      expect(screen.getByText('content child')).toBeInTheDocument()
    })

    it('should parse custom placement and merge custom class names', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)

      // Act
      render(
        <DropdownMenuContent
          placement="top-start"
          sideOffset={12}
          alignOffset={-3}
          className="content-positioner-custom"
          popupClassName="content-popup-custom"
        >
          <span>custom content</span>
        </DropdownMenuContent>,
      )

      // Assert
      const positioner = screen.getByTestId('menu-positioner')
      const popup = screen.getByTestId('menu-popup')

      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('top-start')
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(positioner).toHaveAttribute('data-side-offset', '12')
      expect(positioner).toHaveAttribute('data-align-offset', '-3')
      expect(positioner).toHaveClass('outline-none')
      expect(positioner).toHaveClass('content-positioner-custom')
      expect(popup).toHaveClass('content-popup-custom')
      expect(screen.getByText('custom content')).toBeInTheDocument()
    })
  })

  describe('DropdownMenuSubContent', () => {
    it('should use the default sub-content placement and offsets', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)

      // Act
      render(
        <DropdownMenuSubContent>
          <span>sub content child</span>
        </DropdownMenuSubContent>,
      )

      // Assert
      const positioner = screen.getByTestId('menu-positioner')
      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('left-start')
      expect(positioner).toHaveAttribute('data-side', 'left')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(positioner).toHaveAttribute('data-side-offset', '4')
      expect(positioner).toHaveAttribute('data-align-offset', '0')
      expect(positioner).toHaveClass('outline-none')
      expect(screen.getByText('sub content child')).toBeInTheDocument()
    })

    it('should parse custom placement and merge popup class names', () => {
      // Arrange
      const parsePlacementMock = vi.mocked(parsePlacement)

      // Act
      render(
        <DropdownMenuSubContent
          placement="right-end"
          sideOffset={6}
          alignOffset={2}
          className="sub-positioner-custom"
          popupClassName="sub-popup-custom"
        >
          <span>custom sub content</span>
        </DropdownMenuSubContent>,
      )

      // Assert
      const positioner = screen.getByTestId('menu-positioner')
      const popup = screen.getByTestId('menu-popup')

      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('right-end')
      expect(positioner).toHaveAttribute('data-side', 'right')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('data-side-offset', '6')
      expect(positioner).toHaveAttribute('data-align-offset', '2')
      expect(positioner).toHaveClass('outline-none')
      expect(positioner).toHaveClass('sub-positioner-custom')
      expect(popup).toHaveClass('sub-popup-custom')
    })
  })

  describe('DropdownMenuSubTrigger', () => {
    it('should merge className and apply destructive style when destructive is true', () => {
      // Arrange

      // Act
      render(
        <DropdownMenuSubTrigger className="sub-trigger-custom" destructive>
          Trigger item
        </DropdownMenuSubTrigger>,
      )

      // Assert
      const subTrigger = screen.getByTestId('menu-submenu-trigger')
      expect(subTrigger).toHaveClass('mx-1')
      expect(subTrigger).toHaveClass('sub-trigger-custom')
      expect(subTrigger).toHaveClass('text-text-destructive')
    })

    it('should not apply destructive style when destructive is false', () => {
      // Arrange

      // Act
      render(
        <DropdownMenuSubTrigger className="sub-trigger-custom">
          Trigger item
        </DropdownMenuSubTrigger>,
      )

      // Assert
      expect(screen.getByTestId('menu-submenu-trigger')).not.toHaveClass('text-text-destructive')
    })
  })

  describe('DropdownMenuItem', () => {
    it('should merge className and apply destructive style when destructive is true', () => {
      // Arrange

      // Act
      render(
        <DropdownMenuItem className="item-custom" destructive>
          Item label
        </DropdownMenuItem>,
      )

      // Assert
      const item = screen.getByTestId('menu-item')
      expect(item).toHaveClass('mx-1')
      expect(item).toHaveClass('item-custom')
      expect(item).toHaveClass('text-text-destructive')
    })

    it('should not apply destructive style when destructive is false', () => {
      // Arrange

      // Act
      render(
        <DropdownMenuItem className="item-custom">
          Item label
        </DropdownMenuItem>,
      )

      // Assert
      expect(screen.getByTestId('menu-item')).not.toHaveClass('text-text-destructive')
    })
  })

  describe('DropdownMenuSeparator', () => {
    it('should merge custom class names with default separator classes', () => {
      // Arrange

      // Act
      render(<DropdownMenuSeparator className="separator-custom" />)

      // Assert
      const separator = screen.getByTestId('menu-separator')
      expect(separator).toHaveClass('my-1')
      expect(separator).toHaveClass('h-px')
      expect(separator).toHaveClass('bg-divider-regular')
      expect(separator).toHaveClass('separator-custom')
    })
  })
})
