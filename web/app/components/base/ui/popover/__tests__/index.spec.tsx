import type { Placement } from '@floating-ui/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { PopoverContent } from '..'

type ParsedPlacement = {
  side: 'top' | 'bottom' | 'left' | 'right'
  align: 'start' | 'center' | 'end'
}

type PositionerMockProps = ComponentPropsWithoutRef<'div'> & {
  side?: ParsedPlacement['side']
  align?: ParsedPlacement['align']
  sideOffset?: number
  alignOffset?: number
}

const positionerPropsSpy = vi.fn<(props: PositionerMockProps) => void>()
const popupClassNameSpy = vi.fn<(className: string | undefined) => void>()
const parsePlacementMock = vi.fn<(placement: Placement) => ParsedPlacement>()

vi.mock('@base-ui/react/popover', () => {
  const Root = ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => (
    <div {...props}>{children}</div>
  )

  const Trigger = ({ children, ...props }: ComponentPropsWithoutRef<'button'>) => (
    <button type="button" {...props}>{children}</button>
  )

  const Close = ({ children, ...props }: ComponentPropsWithoutRef<'button'>) => (
    <button type="button" {...props}>{children}</button>
  )

  const Title = ({ children, ...props }: ComponentPropsWithoutRef<'h2'>) => (
    <h2 {...props}>{children}</h2>
  )

  const Description = ({ children, ...props }: ComponentPropsWithoutRef<'p'>) => (
    <p {...props}>{children}</p>
  )

  const Portal = ({ children }: { children?: ReactNode }) => (
    <div data-testid="mock-portal">{children}</div>
  )

  const Positioner = ({ children, ...props }: PositionerMockProps) => {
    positionerPropsSpy(props)
    return (
      <div data-testid="mock-positioner" className={props.className}>
        {children}
      </div>
    )
  }

  const Popup = ({ children, className }: ComponentPropsWithoutRef<'div'>) => {
    popupClassNameSpy(className)
    return (
      <div data-testid="mock-popup" className={className}>
        {children}
      </div>
    )
  }

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

vi.mock('@/app/components/base/ui/placement', () => ({
  parsePlacement: (placement: Placement) => parsePlacementMock(placement),
}))

describe('PopoverContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    parsePlacementMock.mockReturnValue({
      side: 'bottom',
      align: 'center',
    })
  })

  describe('Default props', () => {
    it('should use bottom placement and default offsets when optional props are not provided', () => {
      // Arrange
      render(
        <PopoverContent>
          <span>Default content</span>
        </PopoverContent>,
      )

      // Act
      const positioner = screen.getByTestId('mock-positioner')

      // Assert
      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('bottom')
      expect(positionerPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'bottom',
          align: 'center',
          sideOffset: 8,
          alignOffset: 0,
        }),
      )
      expect(positioner).toHaveClass('outline-none')
      expect(screen.getByText('Default content')).toBeInTheDocument()
    })
  })

  describe('Placement parsing', () => {
    it('should use parsePlacement output and forward custom placement offsets to Positioner', () => {
      // Arrange
      parsePlacementMock.mockReturnValue({
        side: 'left',
        align: 'end',
      })

      // Act
      render(
        <PopoverContent placement="top-end" sideOffset={14} alignOffset={6}>
          <span>Parsed content</span>
        </PopoverContent>,
      )

      // Assert
      expect(parsePlacementMock).toHaveBeenCalledTimes(1)
      expect(parsePlacementMock).toHaveBeenCalledWith('top-end')
      expect(positionerPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'left',
          align: 'end',
          sideOffset: 14,
          alignOffset: 6,
        }),
      )
    })
  })

  describe('ClassName behavior', () => {
    it('should merge custom className values into Positioner and Popup class names', () => {
      // Arrange
      render(
        <PopoverContent className="custom-positioner" popupClassName="custom-popup">
          <span>Styled content</span>
        </PopoverContent>,
      )

      // Act
      const positioner = screen.getByTestId('mock-positioner')
      const popup = screen.getByTestId('mock-popup')

      // Assert
      expect(positioner).toHaveClass('outline-none')
      expect(positioner).toHaveClass('custom-positioner')
      expect(popup).toHaveClass('rounded-xl')
      expect(popup).toHaveClass('custom-popup')
      expect(popupClassNameSpy).toHaveBeenCalledWith(expect.stringContaining('custom-popup'))
    })
  })

  describe('Children rendering', () => {
    it('should render children inside Popup', () => {
      // Arrange
      render(
        <PopoverContent>
          <button type="button">Child action</button>
        </PopoverContent>,
      )

      // Act
      const popup = screen.getByTestId('mock-popup')

      // Assert
      expect(popup).toContainElement(screen.getByRole('button', { name: 'Child action' }))
    })
  })
})
