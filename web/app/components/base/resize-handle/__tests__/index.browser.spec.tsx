import type { ComponentProps } from 'react'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import ResizeHandle from '..'

vi.unmock('react-i18next')

function Panel({ side }: Pick<ComponentProps<typeof ResizeHandle>, 'side'>) {
  const [value, setValue] = useState(480)
  const horizontal = side === 'left' || side === 'right'
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
        className="h-5 w-5"
      />
      <section
        id="panel"
        aria-label="Resizable panel"
        style={horizontal ? { width: value, height: 100 } : { width: 100, height: value }}
      >
        Content
      </section>
      <button type="button">Next control</button>
    </>
  )
}

it.each([
  ['left', 'ArrowLeft', 'ArrowRight', 'vertical'],
  ['right', 'ArrowRight', 'ArrowLeft', 'vertical'],
  ['top', 'ArrowUp', 'ArrowDown', 'horizontal'],
  ['bottom', 'ArrowDown', 'ArrowUp', 'horizontal'],
] as const)(
  'resizes the panel from its %s edge using native keyboard input',
  async (side, increase, decrease, orientation) => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en-US', resources: { 'en-US': { common } }, keySeparator: false })
    await render(
      <I18nextProvider i18n={i18n}>
        <Panel side={side} />
      </I18nextProvider>,
    )
    await userEvent.tab()
    const handle = page.getByRole('separator', { name: 'Panel size' })
    const panel = page.getByRole('region', { name: 'Resizable panel' })
    const size = () =>
      panel.element().getBoundingClientRect()[orientation === 'vertical' ? 'width' : 'height']
    await expect.element(handle).toHaveFocus()
    await userEvent.keyboard(`{${increase}}`)
    await expect.element(handle).toHaveAttribute('aria-valuenow', '488')
    await userEvent.keyboard(`{Shift>}{${increase}}{/Shift}`)
    await expect
      .element(handle)
      .toHaveAttribute(
        'aria-valuetext',
        `${orientation === 'vertical' ? 'Width' : 'Height'}: 520 pixels`,
      )
    expect(size()).toBe(520)
    await userEvent.keyboard(`{${decrease}}`)
    await expect.element(handle).toHaveAttribute('aria-valuenow', '512')
    expect(size()).toBe(512)
    await userEvent.keyboard('{Home}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '400')
    await userEvent.keyboard(`{${decrease}}`)
    expect(size()).toBe(400)
    await userEvent.keyboard('{End}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '600')
    await userEvent.keyboard(`{${increase}}`)
    expect(size()).toBe(600)
    await userEvent.keyboard('{Control>}{ArrowRight}{/Control}{Alt>}{ArrowLeft}{/Alt}')
    expect(size()).toBe(600)
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Next control' })).toHaveFocus()
  },
)
