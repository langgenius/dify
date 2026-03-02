import type { Placement } from '@floating-ui/react'
import type { HTMLAttributes, ReactNode } from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../index'

type MockPortalProps = {
  children: ReactNode
}

type MockPositionerProps = {
  children: ReactNode
  side: string
  align: string
  sideOffset: number
  alignOffset: number
  className?: string
}

type MockPopupProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  className?: string
}

vi.mock('@/app/components/base/ui/placement', () => ({
  parsePlacement: vi.fn(),
}))

vi.mock('@base-ui/react/tooltip', () => ({
  Tooltip: {
    Portal: ({ children }: MockPortalProps) => (
      <div data-testid="tooltip-portal">{children}</div>
    ),
    Positioner: ({
      children,
      side,
      align,
      sideOffset,
      alignOffset,
      className,
    }: MockPositionerProps) => (
      <div
        data-testid="tooltip-positioner"
        data-side={side}
        data-align={align}
        data-side-offset={String(sideOffset)}
        data-align-offset={String(alignOffset)}
        className={className}
      >
        {children}
      </div>
    ),
    Popup: ({ children, className, ...props }: MockPopupProps) => (
      <div data-testid="tooltip-popup" className={className} {...props}>
        {children}
      </div>
    ),
    Provider: ({ children }: MockPortalProps) => (
      <div data-testid="tooltip-provider">{children}</div>
    ),
    Root: ({ children }: MockPortalProps) => (
      <div data-testid="tooltip-root">{children}</div>
    ),
    Trigger: ({ children }: MockPortalProps) => (
      <button data-testid="tooltip-trigger" type="button">
        {children}
      </button>
    ),
  },
}))

const mockParsePlacement = vi.mocked(parsePlacement)

describe('TooltipContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParsePlacement.mockReturnValue({ side: 'top', align: 'center' })
  })

  describe('Placement and offsets', () => {
    it('should use default placement and offsets when optional props are not provided', () => {
      // Arrange
      render(<TooltipContent>Tooltip body</TooltipContent>)

      // Act
      const positioner = screen.getByTestId('tooltip-positioner')

      // Assert
      expect(mockParsePlacement).toHaveBeenCalledWith('top')
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'center')
      expect(positioner).toHaveAttribute('data-side-offset', '8')
      expect(positioner).toHaveAttribute('data-align-offset', '0')
    })

    it('should use parsed placement and custom offsets when placement props are provided', () => {
      // Arrange
      mockParsePlacement.mockReturnValue({ side: 'bottom', align: 'start' })
      const customPlacement: Placement = 'bottom-start'

      // Act
      render(
        <TooltipContent
          placement={customPlacement}
          sideOffset={16}
          alignOffset={6}
        >
          Tooltip body
        </TooltipContent>,
      )
      const positioner = screen.getByTestId('tooltip-positioner')

      // Assert
      expect(mockParsePlacement).toHaveBeenCalledWith(customPlacement)
      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(positioner).toHaveAttribute('data-side-offset', '16')
      expect(positioner).toHaveAttribute('data-align-offset', '6')
    })
  })

  describe('Class behavior', () => {
    it('should merge the positioner className with wrapper base class', () => {
      // Arrange
      render(<TooltipContent className="custom-positioner">Tooltip body</TooltipContent>)

      // Act
      const positioner = screen.getByTestId('tooltip-positioner')

      // Assert
      expect(positioner).toHaveClass('outline-none')
      expect(positioner).toHaveClass('custom-positioner')
    })

    it('should apply default variant popup classes and merge popupClassName when variant is default', () => {
      // Arrange
      render(
        <TooltipContent popupClassName="custom-popup">
          Tooltip body
        </TooltipContent>,
      )

      // Act
      const popup = screen.getByTestId('tooltip-popup')

      // Assert
      expect(popup.className).toContain('bg-components-panel-bg')
      expect(popup.className).toContain('rounded-md')
      expect(popup).toHaveClass('custom-popup')
    })

    it('should avoid default variant popup classes when variant is plain', () => {
      // Arrange
      render(
        <TooltipContent variant="plain" popupClassName="plain-popup">
          Tooltip body
        </TooltipContent>,
      )

      // Act
      const popup = screen.getByTestId('tooltip-popup')

      // Assert
      expect(popup).toHaveClass('plain-popup')
      expect(popup.className).not.toContain('bg-components-panel-bg')
      expect(popup.className).not.toContain('rounded-md')
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
      const popup = screen.getByTestId('tooltip-popup')

      // Assert
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
