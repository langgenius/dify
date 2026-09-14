import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ResizeHandle from '..'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: common } = await import('@/i18n/en-US/common.json')
  return createReactI18nextMock(common)
})

function Panel({ side }: Pick<ComponentProps<typeof ResizeHandle>, 'side'>) {
  const [value, setValue] = useState(480)
  return (
    <>
      <ResizeHandle
        side={side}
        value={value}
        min={400}
        max={600}
        controls="panel"
        label="Panel size"
        onResize={setValue}
      />
      <div id="panel">{value}</div>
      <button>Next control</button>
    </>
  )
}

describe('ResizeHandle', () => {
  it.each([
    ['left', 'ArrowLeft', 'ArrowRight', 'vertical'],
    ['right', 'ArrowRight', 'ArrowLeft', 'vertical'],
    ['top', 'ArrowUp', 'ArrowDown', 'horizontal'],
    ['bottom', 'ArrowDown', 'ArrowUp', 'horizontal'],
  ] as const)(
    'resizes from the %s edge and exposes the current size',
    async (side, increase, decrease, orientation) => {
      const user = userEvent.setup()
      render(<Panel side={side} />)
      await user.tab()
      const handle = screen.getByRole('separator', { name: 'Panel size' })
      expect(handle).toHaveFocus()
      expect(handle).toHaveAttribute('aria-orientation', orientation)
      await user.keyboard(`{${increase}}{Shift>}{${increase}}{/Shift}`)
      expect(handle).toHaveAttribute('aria-valuenow', '520')
      expect(handle).toHaveAttribute(
        'aria-valuetext',
        `${orientation === 'vertical' ? 'Width' : 'Height'}: 520 pixels`,
      )
      await user.keyboard(`{${decrease}}`)
      expect(handle).toHaveAttribute('aria-valuenow', '512')
      await user.keyboard(`{Home}{${decrease}}`)
      expect(handle).toHaveAttribute('aria-valuenow', '400')
      await user.keyboard(`{End}{${increase}}`)
      expect(handle).toHaveAttribute('aria-valuenow', '600')
      await user.tab()
      expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus()
      await user.tab({ shift: true })
      expect(handle).toHaveFocus()
    },
  )

  it('does not consume unrelated shortcuts and retains the mouse handler', async () => {
    const user = userEvent.setup()
    const onResize = vi.fn()
    const onMouseDown = vi.fn()
    render(
      <ResizeHandle
        side="left"
        value={480}
        min={400}
        max={600}
        controls="panel"
        label="Panel size"
        onResize={onResize}
        onMouseDown={onMouseDown}
      />,
    )
    const handle = screen.getByRole('separator', { name: 'Panel size' })
    await user.tab()
    await user.keyboard('{ArrowDown}{Control>}{ArrowRight}{/Control}{Alt>}{ArrowLeft}{/Alt}')
    expect(onResize).not.toHaveBeenCalled()
    fireEvent.mouseDown(handle)
    expect(onMouseDown).toHaveBeenCalledOnce()
  })
})
