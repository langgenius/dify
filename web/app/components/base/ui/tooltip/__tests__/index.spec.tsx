import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../index'

describe('TooltipContent', () => {
  describe('Placement and offsets', () => {
    it('should use default top placement when placement is not provided', () => {
      render(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent role="tooltip" aria-label="default tooltip">
            Tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      const popup = screen.getByRole('tooltip', { name: 'default tooltip' })
      expect(popup).toHaveAttribute('data-side', 'top')
      expect(popup).toHaveAttribute('data-align', 'center')
      expect(popup).toHaveTextContent('Tooltip body')
    })

    it('should apply custom placement when placement props are provided', () => {
      render(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent
            placement="bottom-start"
            sideOffset={16}
            alignOffset={6}
            role="tooltip"
            aria-label="custom tooltip"
          >
            Custom tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      const popup = screen.getByRole('tooltip', { name: 'custom tooltip' })
      expect(popup).toHaveAttribute('data-side', 'bottom')
      expect(popup).toHaveAttribute('data-align', 'start')
      expect(popup).toHaveTextContent('Custom tooltip body')
    })
  })

  describe('Variant and popup props', () => {
    it('should render popup content when variant is plain', () => {
      render(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent variant="plain" role="tooltip" aria-label="plain tooltip">
            Plain tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      expect(screen.getByRole('tooltip', { name: 'plain tooltip' })).toHaveTextContent('Plain tooltip body')
    })

    it('should forward popup props and handlers when popup props are provided', () => {
      const onMouseEnter = vi.fn()

      render(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent
            id="tooltip-popup-id"
            role="tooltip"
            aria-label="help text"
            data-track-id="tooltip-track"
            onMouseEnter={onMouseEnter}
          >
            Tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      const popup = screen.getByRole('tooltip', { name: 'help text' })
      fireEvent.mouseEnter(popup)

      expect(popup).toHaveAttribute('id', 'tooltip-popup-id')
      expect(popup).toHaveAttribute('data-track-id', 'tooltip-track')
      expect(onMouseEnter).toHaveBeenCalledTimes(1)
    })
  })
})

describe('Tooltip aliases', () => {
  it('should map alias exports to BaseTooltip components when wrapper exports are imported', () => {
    expect(TooltipProvider).toBe(BaseTooltip.Provider)
    expect(Tooltip).toBe(BaseTooltip.Root)
    expect(TooltipTrigger).toBe(BaseTooltip.Trigger)
  })
})
