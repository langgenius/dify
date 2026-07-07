import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../base-ui-popover'

type PopoverHarnessProps = {
  useRenderElement?: boolean
  preventDefaultOnTrigger?: boolean
}

const PopoverHarness = ({
  useRenderElement = false,
  preventDefaultOnTrigger = false,
}: PopoverHarnessProps) => {
  const [open, setOpen] = React.useState(false)

  return (
    <div>
      <div data-testid="outside-area">outside</div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={useRenderElement
            ? (
                <button
                  type="button"
                  data-testid="custom-trigger"
                  onClick={(event) => {
                    if (preventDefaultOnTrigger)
                      event.preventDefault()
                  }}
                >
                  toggle
                </button>
              )
            : undefined}
        >
          fallback trigger
        </PopoverTrigger>
        <PopoverContent
          className="custom-content"
          placement="bottom-start"
          sideOffset={4}
          alignOffset={8}
          positionerProps={{ 'data-positioner': 'true' } as unknown as React.HTMLAttributes<HTMLDivElement>}
          popupProps={{ 'data-popup': 'true' } as unknown as React.HTMLAttributes<HTMLDivElement>}
        >
          <div>popover body</div>
        </PopoverContent>
      </Popover>
      <div data-testid="open-state">{open ? 'open' : 'closed'}</div>
    </div>
  )
}

describe('base-ui-popover mock', () => {
  it('should toggle popover content from the fallback trigger and expose content props', () => {
    render(<PopoverHarness />)

    expect(screen.getByTestId('open-state')).toHaveTextContent('closed')
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('popover-trigger'))

    expect(screen.getByTestId('open-state')).toHaveTextContent('open')
    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-placement', 'bottom-start')
    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-side-offset', '4')
    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-align-offset', '8')
    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-positioner', 'true')
    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-popup', 'true')
    expect(screen.getByTestId('popover-content')).toHaveClass('custom-content')
  })

  it('should keep the popover open on inside clicks and close it on outside clicks or escape', () => {
    render(<PopoverHarness useRenderElement />)

    fireEvent.click(screen.getByTestId('custom-trigger'))
    expect(screen.getByTestId('open-state')).toHaveTextContent('open')

    fireEvent.mouseDown(screen.getByTestId('popover-content'))
    expect(screen.getByTestId('open-state')).toHaveTextContent('open')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('open-state')).toHaveTextContent('closed')

    fireEvent.click(screen.getByTestId('custom-trigger'))
    expect(screen.getByTestId('open-state')).toHaveTextContent('open')

    fireEvent.mouseDown(screen.getByTestId('outside-area'))
    expect(screen.getByTestId('open-state')).toHaveTextContent('closed')
  })

  it('should preserve rendered trigger props and respect preventDefault', () => {
    render(<PopoverHarness useRenderElement preventDefaultOnTrigger />)

    fireEvent.click(screen.getByTestId('custom-trigger'))

    expect(screen.getByTestId('custom-trigger')).toHaveAttribute('data-popover-trigger', 'true')
    expect(screen.getByTestId('open-state')).toHaveTextContent('closed')
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
  })

  it('should keep the popover closed when the fallback trigger click is prevented', () => {
    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
    }

    render(
      <div>
        <Popover open={false} onOpenChange={vi.fn()}>
          <PopoverTrigger onClick={handleClick}>
            fallback trigger
          </PopoverTrigger>
          <PopoverContent>
            <div>popover body</div>
          </PopoverContent>
        </Popover>
      </div>,
    )

    fireEvent.click(screen.getByTestId('popover-trigger'))

    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
  })
})
