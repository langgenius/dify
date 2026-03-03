import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { render, screen } from '@testing-library/react'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '..'

type PrimitiveProps = ComponentPropsWithoutRef<'div'> & {
  children?: ReactNode
}

type PositionerProps = PrimitiveProps & {
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  alignOffset?: number
}

vi.mock('@base-ui/react/popover', () => {
  const Root = ({ children, ...props }: PrimitiveProps) => (
    <div {...props}>
      {children}
    </div>
  )

  const Trigger = ({ children, ...props }: ComponentPropsWithoutRef<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )

  const Close = ({ children, ...props }: ComponentPropsWithoutRef<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )

  const Title = ({ children, ...props }: ComponentPropsWithoutRef<'h2'>) => (
    <h2 {...props}>
      {children}
    </h2>
  )

  const Description = ({ children, ...props }: ComponentPropsWithoutRef<'p'>) => (
    <p {...props}>
      {children}
    </p>
  )

  const Portal = ({ children }: PrimitiveProps) => (
    <div>{children}</div>
  )

  const Positioner = ({
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    ...props
  }: PositionerProps) => (
    <div
      data-side={side}
      data-align={align}
      data-side-offset={String(sideOffset)}
      data-align-offset={String(alignOffset)}
      {...props}
    >
      {children}
    </div>
  )

  const Popup = ({ children, ...props }: PrimitiveProps) => (
    <div {...props}>
      {children}
    </div>
  )

  return {
    Popover: {
      Root,
      Trigger,
      Close,
      Title,
      Description,
      Portal,
      Positioner,
      Popup,
    },
  }
})

describe('PopoverContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Placement and default value behaviors.
  describe('Placement', () => {
    it('should use bottom placement and default offsets when placement props are not provided', () => {
      // Arrange
      render(
        <PopoverContent positionerProps={{ 'aria-label': 'default positioner' }}>
          <span>Default content</span>
        </PopoverContent>,
      )

      // Act
      const positioner = screen.getByLabelText('default positioner')

      // Assert
      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'center')
      expect(positioner).toHaveAttribute('data-side-offset', '8')
      expect(positioner).toHaveAttribute('data-align-offset', '0')
      expect(screen.getByText('Default content')).toBeInTheDocument()
    })

    it('should apply parsed custom placement and custom offsets when placement props are provided', () => {
      // Arrange
      render(
        <PopoverContent
          placement="top-end"
          sideOffset={14}
          alignOffset={6}
          positionerProps={{ 'aria-label': 'custom positioner' }}
        >
          <span>Custom placement content</span>
        </PopoverContent>,
      )

      // Act
      const positioner = screen.getByLabelText('custom positioner')

      // Assert
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('data-side-offset', '14')
      expect(positioner).toHaveAttribute('data-align-offset', '6')
    })
  })

  // Passthrough behavior for delegated primitives.
  describe('Passthrough props', () => {
    it('should forward positionerProps and popupProps when passthrough props are provided', () => {
      // Arrange
      render(
        <PopoverContent
          positionerProps={{
            'aria-label': 'popover positioner',
          }}
          popupProps={{
            'id': 'popover-popup-id',
            'role': 'dialog',
            'aria-label': 'popover content',
          }}
        >
          <span>Popover body</span>
        </PopoverContent>,
      )

      // Act
      const positioner = screen.getByLabelText('popover positioner')
      const popup = screen.getByRole('dialog', { name: 'popover content' })

      // Assert
      expect(positioner).toHaveAttribute('aria-label', 'popover positioner')
      expect(popup).toHaveAttribute('id', 'popover-popup-id')
      expect(popup).toHaveAttribute('role', 'dialog')
      expect(popup).toHaveAttribute('aria-label', 'popover content')
    })
  })
})

describe('Popover aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Export mapping behavior to keep wrapper aliases aligned.
  describe('Export mapping', () => {
    it('should map aliases to the matching base popover primitives when wrapper exports are imported', () => {
      // Arrange
      const basePrimitives = BasePopover

      // Act & Assert
      expect(Popover).toBe(basePrimitives.Root)
      expect(PopoverTrigger).toBe(basePrimitives.Trigger)
      expect(PopoverClose).toBe(basePrimitives.Close)
      expect(PopoverTitle).toBe(basePrimitives.Title)
      expect(PopoverDescription).toBe(basePrimitives.Description)
    })
  })
})
