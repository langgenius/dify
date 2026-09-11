import * as React from 'react'
import { render } from 'vitest-browser-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../index'

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

describe('TooltipContent', () => {
  describe('Placement and offsets', () => {
    it('should use default top placement when placement is not provided', async () => {
      const screen = await renderWithSafeViewport(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>,
      )

      await expect.element(screen.getByText('Tooltip body')).toHaveAttribute('data-side', 'top')
      await expect.element(screen.getByText('Tooltip body')).toHaveAttribute('data-align', 'center')
    })

    it('should apply custom placement when placement props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent placement="bottom-start" sideOffset={16} alignOffset={6}>
            Custom tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      await expect
        .element(screen.getByText('Custom tooltip body'))
        .toHaveAttribute('data-side', 'bottom')
      await expect
        .element(screen.getByText('Custom tooltip body'))
        .toHaveAttribute('data-align', 'start')
    })
  })

  describe('Popup props', () => {
    it('should forward popup props and handlers when popup props are provided', async () => {
      const onMouseEnter = vi.fn()

      const screen = await render(
        <Tooltip open>
          <TooltipTrigger aria-label="tooltip trigger">Trigger</TooltipTrigger>
          <TooltipContent
            id="tooltip-popup-id"
            data-track-id="tooltip-track"
            onMouseEnter={onMouseEnter}
          >
            Tooltip body
          </TooltipContent>
        </Tooltip>,
      )

      const popup = screen.getByText('Tooltip body')
      await popup.hover()

      await expect.element(popup).toHaveAttribute('id', 'tooltip-popup-id')
      await expect.element(popup).toHaveAttribute('data-track-id', 'tooltip-track')
      expect(onMouseEnter).toHaveBeenCalled()
    })
  })
})
