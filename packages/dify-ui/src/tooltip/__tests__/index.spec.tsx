import { render } from 'vitest-browser-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../index'

const renderWithSafeViewport = (ui: import('react').ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

describe('TooltipContent', () => {
  describe('Placement and offsets', () => {
    it('should use default top placement when placement is not provided', async () => {
      const screen = await renderWithSafeViewport(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent role="tooltip" aria-label="default tooltip">
            Tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      await expect.element(screen.getByRole('tooltip', { name: 'default tooltip' })).toHaveAttribute('data-side', 'top')
      await expect.element(screen.getByRole('tooltip', { name: 'default tooltip' })).toHaveAttribute('data-align', 'center')
      await expect.element(screen.getByRole('tooltip', { name: 'default tooltip' })).toHaveTextContent('Tooltip body')
    })

    it('should apply custom placement when placement props are provided', async () => {
      const screen = await renderWithSafeViewport(
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

      await expect.element(screen.getByRole('tooltip', { name: 'custom tooltip' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('tooltip', { name: 'custom tooltip' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('tooltip', { name: 'custom tooltip' })).toHaveTextContent('Custom tooltip body')
    })
  })

  describe('Variant and popup props', () => {
    it('should render popup content when variant is plain', async () => {
      const screen = await render(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent variant="plain" role="tooltip" aria-label="plain tooltip">
            Plain tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      await expect.element(screen.getByRole('tooltip', { name: 'plain tooltip' })).toHaveTextContent('Plain tooltip body')
    })

    it('should forward popup props and handlers when popup props are provided', async () => {
      const onMouseEnter = vi.fn()

      const screen = await render(
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
      await popup.hover()

      await expect.element(popup).toHaveAttribute('id', 'tooltip-popup-id')
      await expect.element(popup).toHaveAttribute('data-track-id', 'tooltip-track')
      expect(onMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('should apply className to the popup and positionerClassName to the positioner', async () => {
      const screen = await render(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent
            className="popup-class"
            positionerClassName="positioner-class"
            role="tooltip"
            aria-label="styled tooltip"
          >
            Tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      const popup = screen.getByRole('tooltip', { name: 'styled tooltip' }).element()
      expect(popup).toHaveClass('popup-class')
      expect(popup.parentElement).toHaveClass('positioner-class')
    })
  })
})
