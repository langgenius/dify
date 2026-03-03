import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import type { Placement } from '@/app/components/base/ui/placement'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../index'

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
const popupPropsSpy = vi.fn<(props: ComponentPropsWithoutRef<'div'>) => void>()
const parsePlacementMock = vi.fn<(placement: Placement) => ParsedPlacement>()

vi.mock('@/app/components/base/ui/placement', () => ({
  parsePlacement: (placement: Placement) => parsePlacementMock(placement),
}))

vi.mock('@base-ui/react/tooltip', () => {
  const Portal = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )

  const Positioner = ({ children, ...props }: PositionerMockProps) => {
    positionerPropsSpy(props)
    return <div>{children}</div>
  }

  const Popup = ({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) => {
    popupPropsSpy({ className, ...props })
    return (
      <div className={className} {...props}>
        {children}
      </div>
    )
  }

  const Provider = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )

  const Root = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )

  const Trigger = ({ children }: { children?: ReactNode }) => (
    <button type="button">
      {children}
    </button>
  )

  return {
    Tooltip: {
      Portal,
      Positioner,
      Popup,
      Provider,
      Root,
      Trigger,
    },
  }
})

describe('TooltipContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    parsePlacementMock.mockReturnValue({ side: 'top', align: 'center' })
  })

  describe('Placement and offsets', () => {
    it('should use default placement and offsets when optional props are not provided', () => {
      // Arrange
      render(<TooltipContent>Tooltip body</TooltipContent>)

      // Act
      const positionerProps = positionerPropsSpy.mock.calls.at(-1)?.[0]

      // Assert
      expect(parsePlacementMock).toHaveBeenCalledWith('top')
      expect(positionerProps).toEqual(expect.objectContaining({
        side: 'top',
        align: 'center',
        sideOffset: 8,
        alignOffset: 0,
      }))
      expect(screen.getByText('Tooltip body')).toBeInTheDocument()
    })

    it('should use parsed placement and custom offsets when placement props are provided', () => {
      // Arrange
      parsePlacementMock.mockReturnValue({ side: 'bottom', align: 'start' })
      const customPlacement: Placement = 'bottom-start'

      // Act
      render(
        <TooltipContent
          placement={customPlacement}
          sideOffset={16}
          alignOffset={6}
        >
          Custom tooltip body
        </TooltipContent>,
      )
      const positionerProps = positionerPropsSpy.mock.calls.at(-1)?.[0]

      // Assert
      expect(parsePlacementMock).toHaveBeenCalledWith(customPlacement)
      expect(positionerProps).toEqual(expect.objectContaining({
        side: 'bottom',
        align: 'start',
        sideOffset: 16,
        alignOffset: 6,
      }))
      expect(screen.getByText('Custom tooltip body')).toBeInTheDocument()
    })
  })

  describe('Variant behavior', () => {
    it('should compute a different popup presentation contract for plain variant than default', () => {
      // Arrange
      const { rerender } = render(
        <TooltipContent variant="default">
          Default tooltip body
        </TooltipContent>,
      )
      const defaultPopupProps = popupPropsSpy.mock.calls.at(-1)?.[0]

      // Act
      rerender(
        <TooltipContent variant="plain">
          Plain tooltip body
        </TooltipContent>,
      )
      const plainPopupProps = popupPropsSpy.mock.calls.at(-1)?.[0]

      // Assert
      expect(screen.getByText('Plain tooltip body')).toBeInTheDocument()
      expect(defaultPopupProps?.className).toBeTypeOf('string')
      expect(plainPopupProps?.className).toBeTypeOf('string')
      expect(plainPopupProps?.className).not.toBe(defaultPopupProps?.className)
    })
  })

  describe('Popup prop forwarding', () => {
    it('should forward popup props to BaseTooltip.Popup when popup props are provided', () => {
      // Arrange
      render(
        <TooltipContent
          id="popup-id"
          role="tooltip"
          aria-label="help text"
          data-track-id="tooltip-track"
        >
          Tooltip body
        </TooltipContent>,
      )

      // Act
      const popup = screen.getByRole('tooltip', { name: 'help text' })
      const popupProps = popupPropsSpy.mock.calls.at(-1)?.[0]

      // Assert
      expect(popupProps).toEqual(expect.objectContaining({
        'id': 'popup-id',
        'role': 'tooltip',
        'aria-label': 'help text',
        'data-track-id': 'tooltip-track',
      }))
      expect(popup).toHaveAttribute('id', 'popup-id')
      expect(popup).toHaveAttribute('role', 'tooltip')
      expect(popup).toHaveAttribute('aria-label', 'help text')
      expect(popup).toHaveAttribute('data-track-id', 'tooltip-track')
    })
  })
})

describe('Tooltip aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should map alias exports to BaseTooltip components when wrapper exports are imported', () => {
    // Arrange
    const provider = BaseTooltip.Provider
    const root = BaseTooltip.Root
    const trigger = BaseTooltip.Trigger

    // Act
    const exportedProvider = TooltipProvider
    const exportedTooltip = Tooltip
    const exportedTrigger = TooltipTrigger

    // Assert
    expect(exportedProvider).toBe(provider)
    expect(exportedTooltip).toBe(root)
    expect(exportedTrigger).toBe(trigger)
  })
})
