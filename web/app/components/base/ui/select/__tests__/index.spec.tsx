import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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
  mockParsePlacement: vi.fn<(placement: string) => ParsedPlacement>(),
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
    alignItemWithTrigger?: boolean
  }

  const Root = ({ children }: WithChildren) => <div>{children}</div>
  const Value = ({ children }: WithChildren) => <span>{children}</span>
  const Group = ({ children }: WithChildren) => <div>{children}</div>
  const GroupLabel = ({ children }: WithChildren) => <div>{children}</div>
  const Separator = (props: HTMLAttributes<HTMLHRElement>) => <hr {...props} />

  const Trigger = ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
  const Icon = ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span aria-label="Open select menu" role="img" {...props}>
      {children}
    </span>
  )

  const Portal = ({ children }: WithChildren) => <div>{children}</div>
  const Positioner = ({
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    alignItemWithTrigger,
    className,
    ...props
  }: PositionerProps) => (
    <div
      data-align={align}
      data-align-offset={alignOffset}
      data-align-item-with-trigger={alignItemWithTrigger === undefined ? undefined : String(alignItemWithTrigger)}
      data-side={side}
      data-side-offset={sideOffset}
      className={className}
      {...props}
    >
      {children}
    </div>
  )
  const Popup = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>
      {children}
    </div>
  )
  const List = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>
      {children}
    </div>
  )

  const Item = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div role="option" {...props}>
      {children}
    </div>
  )
  const ItemText = ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>
      {children}
    </span>
  )
  const ItemIndicator = ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span aria-label="Selected item indicator" role="img" {...props}>
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

  // Covers default rendering and visual branches for trigger content.
  describe('SelectTrigger', () => {
    it('should render the default icon when clearable and loading are not enabled', () => {
      // Arrange
      render(<SelectTrigger>Trigger Label</SelectTrigger>)

      // Assert
      expect(screen.getByText('Trigger Label')).toBeInTheDocument()
      expect(screen.getByRole('img', { name: /open select menu/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /clear selection/i })).not.toBeInTheDocument()
    })

    it('should render clear button when clearable is true and loading is false', () => {
      // Arrange
      render(<SelectTrigger clearable>Trigger Label</SelectTrigger>)

      // Assert
      expect(screen.getByRole('button', { name: /clear selection/i })).toBeInTheDocument()
      expect(screen.queryByRole('img', { name: /open select menu/i })).not.toBeInTheDocument()
    })

    it('should render loading indicator and hide clear button when loading is true', () => {
      // Arrange
      render(<SelectTrigger clearable loading>Trigger Label</SelectTrigger>)

      // Assert
      expect(screen.getByRole('button', { name: /trigger label/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /clear selection/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('img', { name: /open select menu/i })).not.toBeInTheDocument()
    })

    it('should forward native trigger props when trigger props are provided', () => {
      // Arrange
      render(
        <SelectTrigger
          aria-label="Choose option"
          disabled
        >
          Trigger Label
        </SelectTrigger>,
      )

      // Assert
      const trigger = screen.getByRole('button', { name: /choose option/i })
      expect(trigger).toBeDisabled()
      expect(trigger).toHaveAttribute('aria-label', 'Choose option')
    })

    it('should call onClear and stop click propagation when clear button is clicked', () => {
      // Arrange
      const onClear = vi.fn()
      const onTriggerClick = vi.fn()
      render(
        <SelectTrigger clearable onClear={onClear} onClick={onTriggerClick}>
          Trigger Label
        </SelectTrigger>,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: /clear selection/i }))

      // Assert
      expect(onClear).toHaveBeenCalledTimes(1)
      expect(onTriggerClick).not.toHaveBeenCalled()
    })

    it('should stop mouse down propagation when clear button receives mouse down', () => {
      // Arrange
      const onTriggerMouseDown = vi.fn()
      render(
        <SelectTrigger clearable onMouseDown={onTriggerMouseDown}>
          Trigger Label
        </SelectTrigger>,
      )

      // Act
      fireEvent.mouseDown(screen.getByRole('button', { name: /clear selection/i }))

      // Assert
      expect(onTriggerMouseDown).not.toHaveBeenCalled()
    })

    it('should not throw when clear button is clicked without onClear handler', () => {
      // Arrange
      render(<SelectTrigger clearable>Trigger Label</SelectTrigger>)
      const clearButton = screen.getByRole('button', { name: /clear selection/i })

      // Act & Assert
      expect(() => fireEvent.click(clearButton)).not.toThrow()
    })
  })

  // Covers content placement parsing, forwarding props, and slot rendering.
  describe('SelectContent', () => {
    it('should call parsePlacement with default placement when placement is not provided', () => {
      // Arrange
      mockParsePlacement.mockReturnValueOnce({ side: 'bottom', align: 'start' })

      // Act
      render(
        <SelectContent>
          <span>Option A</span>
        </SelectContent>,
      )

      // Assert
      expect(mockParsePlacement).toHaveBeenCalledWith('bottom-start')
      expect(screen.getByText('Option A')).toBeInTheDocument()
    })

    it('should pass parsed side align and offsets to Positioner when custom placement and offsets are provided', () => {
      // Arrange
      mockParsePlacement.mockReturnValueOnce({ side: 'top', align: 'end' })

      // Act
      render(
        <SelectContent
          alignOffset={6}
          placement="top-end"
          sideOffset={12}
          positionerProps={{ 'role': 'group', 'aria-label': 'Select positioner' }}
        >
          <div>Option A</div>
        </SelectContent>,
      )

      // Assert
      const positioner = screen.getByRole('group', { name: /select positioner/i })
      expect(mockParsePlacement).toHaveBeenCalledWith('top-end')
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('data-side-offset', '12')
      expect(positioner).toHaveAttribute('data-align-offset', '6')
      expect(positioner).toHaveAttribute('data-align-item-with-trigger', 'false')
    })

    it('should forward passthrough props to positioner popup and list when passthrough props are provided', () => {
      // Arrange & Act
      render(
        <SelectContent
          positionerProps={{
            'role': 'group',
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
      const positioner = screen.getByRole('group', { name: /select positioner/i })
      const popup = screen.getByRole('dialog', { name: /select popup/i })
      const list = screen.getByRole('listbox', { name: /select list/i })

      expect(positioner).toHaveAttribute('aria-label', 'select positioner')
      expect(popup).toHaveAttribute('role', 'dialog')
      expect(popup).toHaveAttribute('aria-label', 'select popup')
      expect(list).toHaveAttribute('role', 'listbox')
      expect(list).toHaveAttribute('aria-label', 'select list')
    })
  })

  // Covers option item rendering and prop forwarding behavior.
  describe('SelectItem', () => {
    it('should render item text and indicator when children are provided', () => {
      // Arrange
      render(<SelectItem>Seattle</SelectItem>)

      // Assert
      expect(screen.getByRole('option', { name: /seattle/i })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: /selected item indicator/i })).toBeInTheDocument()
    })

    it('should forward item props when item props are provided', () => {
      // Arrange
      render(
        <SelectItem aria-label="City option" disabled>
          Seattle
        </SelectItem>,
      )

      // Assert
      const item = screen.getByRole('option', { name: /city option/i })
      expect(item).toHaveAttribute('aria-label', 'City option')
      expect(item).toHaveAttribute('disabled')
    })
  })
})
