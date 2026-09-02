import type { ComponentProps } from 'react'
import type { UseResizePanelParams } from '../use-resize-panel'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useResizePanel } from '../use-resize-panel'

type ResizeHarnessProps = Pick<
  UseResizePanelParams,
  | 'currentHeight'
  | 'currentWidth'
  | 'direction'
  | 'maxHeight'
  | 'maxWidth'
  | 'minHeight'
  | 'minWidth'
  | 'onResize'
  | 'triggerDirection'
>

const ResizeHarness = ({
  currentHeight,
  currentWidth,
  direction,
  maxHeight,
  maxWidth,
  minHeight,
  minWidth,
  onResize,
  triggerDirection,
}: ResizeHarnessProps) => {
  const { containerRef, resizeHandleProps, triggerRef } = useResizePanel({
    currentHeight,
    currentWidth,
    direction,
    maxHeight,
    maxWidth,
    minHeight,
    minWidth,
    onResize,
    triggerDirection,
  })
  const containerStyle: ComponentProps<'div'>['style'] = {
    height: currentHeight,
    width: currentWidth,
  }

  return (
    <>
      <div ref={triggerRef} {...resizeHandleProps} aria-label="Resize panel" />
      <div ref={containerRef} data-testid="panel" style={containerStyle} />
    </>
  )
}

describe('useResizePanel', () => {
  it('resizes a left-anchored width with the arrow keys', async () => {
    const user = userEvent.setup()
    const onResize = vi.fn()
    render(
      <ResizeHarness
        currentWidth={400}
        direction="horizontal"
        minWidth={300}
        maxWidth={500}
        onResize={onResize}
        triggerDirection="left"
      />,
    )
    const separator = screen.getByRole('separator', { name: 'Resize panel' })

    separator.focus()
    await user.keyboard('{ArrowLeft}')

    expect(onResize).toHaveBeenCalledWith(410, 0)
    expect(screen.getByTestId('panel')).toHaveStyle({ width: '410px' })
  })

  it('resizes a top-anchored height and exposes its range', async () => {
    const user = userEvent.setup()
    const onResize = vi.fn()
    render(
      <ResizeHarness
        currentHeight={320}
        direction="vertical"
        minHeight={120}
        maxHeight={480}
        onResize={onResize}
        triggerDirection="top"
      />,
    )
    const separator = screen.getByRole('separator', { name: 'Resize panel' })

    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    expect(separator).toHaveAttribute('aria-valuemin', '120')
    expect(separator).toHaveAttribute('aria-valuemax', '480')
    expect(separator).toHaveAttribute('aria-valuenow', '320')

    separator.focus()
    await user.keyboard('{ArrowUp}')

    expect(onResize).toHaveBeenCalledWith(0, 330)
    expect(screen.getByTestId('panel')).toHaveStyle({ height: '330px' })
  })
})
