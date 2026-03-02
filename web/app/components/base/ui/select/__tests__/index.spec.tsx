import type { Placement } from '@floating-ui/react'
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '../index'

type ParsedPlacement = {
  side: 'top' | 'bottom' | 'left' | 'right'
  align: 'start' | 'center' | 'end'
}

const { mockParsePlacement } = vi.hoisted(() => ({
  mockParsePlacement: vi.fn<(placement: Placement) => ParsedPlacement>(),
}))

vi.mock('@/app/components/base/ui/placement', () => ({
  parsePlacement: mockParsePlacement,
}))

vi.mock('@base-ui/react/select', () => {
  type WithChildren = { children?: ReactNode }
  type PositionerProps = HTMLAttributes<HTMLDivElement> & {
    side?: 'top' | 'bottom' | 'left' | 'right'
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    alignOffset?: number
  }

  const Root = ({ children }: WithChildren) => <div data-testid="base-select-root">{children}</div>
  const Value = ({ children }: WithChildren) => <span data-testid="base-select-value">{children}</span>
  const Group = ({ children }: WithChildren) => <div data-testid="base-select-group">{children}</div>
  const GroupLabel = ({ children }: WithChildren) => <div data-testid="base-select-group-label">{children}</div>
  const Separator = (props: HTMLAttributes<HTMLHRElement>) => <hr data-testid="base-select-separator" {...props} />

  const Trigger = ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button data-testid="base-select-trigger" type="button" {...props}>
      {children}
    </button>
  )
  const Icon = ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="base-select-icon" {...props}>
      {children}
    </span>
  )

  const Portal = ({ children }: WithChildren) => <div data-testid="base-select-portal">{children}</div>
  const Positioner = ({
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    className,
    ...props
  }: PositionerProps) => (
    <div
      data-align={align}
      data-align-offset={alignOffset}
      data-side={side}
      data-side-offset={sideOffset}
      data-testid="base-select-positioner"
      className={className}
      {...props}
    >
      {children}
    </div>
  )
  const Popup = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="base-select-popup" {...props}>
      {children}
    </div>
  )
  const List = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="base-select-list" {...props}>
      {children}
    </div>
  )

  const Item = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="base-select-item" {...props}>
      {children}
    </div>
  )
  const ItemText = ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="base-select-item-text" {...props}>
      {children}
    </span>
  )
  const ItemIndicator = ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="base-select-item-indicator" {...props}>
      {children}
    </span>
  )

  return {
    Select: {
      Root,
      Value,
      Group,
      GroupLabel,
      Separator,
      Trigger,
      Icon,
      Portal,
      Positioner,
      Popup,
      List,
      Item,
      ItemText,
      ItemIndicator,
    },
  }
})

describe('Select wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParsePlacement.mockReturnValue({ side: 'bottom', align: 'start' })
  })

  // Covers trigger-level wrapper behavior.
  describe('SelectTrigger', () => {
    it('should forward trigger props when trigger props are provided', () => {
      // Arrange
      render(
        <SelectTrigger
          aria-label="Choose option"
          data-testid="custom-trigger"
          disabled
        >
          Trigger Label
        </SelectTrigger>,
      )

      // Assert
      const trigger = screen.getByTestId('custom-trigger')
      expect(trigger).toBeDisabled()
      expect(trigger).toHaveAttribute('aria-label', 'Choose option')
      expect(trigger).toHaveAttribute('data-testid', 'custom-trigger')
    })

    it('should compose default and custom class names when className is provided', () => {
      // Arrange & Act
      render(<SelectTrigger className="custom-trigger-class">Trigger Label</SelectTrigger>)

      // Assert
      const trigger = screen.getByTestId('base-select-trigger')
      expect(trigger).toHaveClass('group')
      expect(trigger).toHaveClass('h-8')
      expect(trigger).toHaveClass('custom-trigger-class')
    })

    it('should render children and icon when content is provided', () => {
      // Arrange & Act
      render(<SelectTrigger>Trigger Label</SelectTrigger>)

      // Assert
      expect(screen.getByText('Trigger Label')).toBeInTheDocument()
      expect(screen.getByTestId('base-select-icon')).toBeInTheDocument()
    })
  })

  // Covers content placement parsing and positioner forwarding.
  describe('SelectContent', () => {
    it('should call parsePlacement with default placement when placement is not provided', () => {
      // Arrange
      mockParsePlacement.mockReturnValueOnce({ side: 'bottom', align: 'start' })

      // Act
      render(<SelectContent><div>Option A</div></SelectContent>)

      // Assert
      expect(mockParsePlacement).toHaveBeenCalledWith('bottom-start')
    })

    it('should pass parsed side align and offsets to Positioner when custom placement and offsets are provided', () => {
      // Arrange
      mockParsePlacement.mockReturnValueOnce({ side: 'top', align: 'end' })

      // Act
      render(
        <SelectContent alignOffset={6} placement="top-end" sideOffset={12}>
          <div>Option A</div>
        </SelectContent>,
      )

      // Assert
      const positioner = screen.getByTestId('base-select-positioner')
      expect(mockParsePlacement).toHaveBeenCalledWith('top-end')
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('data-side-offset', '12')
      expect(positioner).toHaveAttribute('data-align-offset', '6')
    })

    it('should compose positioner popup and list class names when custom class props are provided', () => {
      // Arrange & Act
      render(
        <SelectContent
          className="custom-positioner"
          listClassName="custom-list"
          popupClassName="custom-popup"
        >
          <div>Option A</div>
        </SelectContent>,
      )

      // Assert
      expect(screen.getByTestId('base-select-positioner')).toHaveClass('outline-none', 'custom-positioner')
      expect(screen.getByTestId('base-select-popup')).toHaveClass('rounded-xl', 'custom-popup')
      expect(screen.getByTestId('base-select-list')).toHaveClass('max-h-80', 'custom-list')
    })

    it('should forward passthrough props to positioner popup and list when passthrough props are provided', () => {
      // Arrange & Act
      render(
        <SelectContent
          positionerProps={{
            'aria-label': 'select positioner',
          }}
          popupProps={{
            'role': 'dialog',
            'aria-label': 'select popup',
          }}
          listProps={{
            'role': 'listbox',
            'aria-label': 'select list',
          }}
        >
          <div>Option A</div>
        </SelectContent>,
      )

      // Assert
      const positioner = screen.getByTestId('base-select-positioner')
      const popup = screen.getByTestId('base-select-popup')
      const list = screen.getByTestId('base-select-list')

      expect(positioner).toHaveAttribute('aria-label', 'select positioner')
      expect(popup).toHaveAttribute('role', 'dialog')
      expect(popup).toHaveAttribute('aria-label', 'select popup')
      expect(list).toHaveAttribute('role', 'listbox')
      expect(list).toHaveAttribute('aria-label', 'select list')
    })

    it('should render children inside list when children are provided', () => {
      // Arrange & Act
      render(
        <SelectContent>
          <span data-testid="list-child">Option A</span>
        </SelectContent>,
      )

      // Assert
      const list = screen.getByTestId('base-select-list')
      expect(list).toContainElement(screen.getByTestId('list-child'))
    })
  })

  // Covers option item wrapper behavior.
  describe('SelectItem', () => {
    it('should forward props and compose class names when item props are provided', () => {
      // Arrange & Act
      render(
        <SelectItem aria-label="City option" className="custom-item-class" data-testid="city-option-item">
          Seattle
        </SelectItem>,
      )

      // Assert
      const item = screen.getByTestId('city-option-item')
      expect(item).toHaveAttribute('aria-label', 'City option')
      expect(item).toHaveAttribute('data-testid', 'city-option-item')
      expect(item).toHaveClass('h-8')
      expect(item).toHaveClass('custom-item-class')
    })

    it('should render item text and indicator when children are provided', () => {
      // Arrange & Act
      render(<SelectItem>Seattle</SelectItem>)

      // Assert
      expect(screen.getByTestId('base-select-item-text')).toHaveTextContent('Seattle')
      expect(screen.getByTestId('base-select-item-indicator')).toBeInTheDocument()
    })
  })
})
