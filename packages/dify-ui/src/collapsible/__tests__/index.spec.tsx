import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconButton } from '../../icon-button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '../index'

it('preserves IconButton appearance and keyboard focus when used as a disclosure trigger', async () => {
  const screen = await render(
    <div className="flex items-start gap-4">
      <IconButton aria-label="Reference">
        <span aria-hidden className="i-ri-information-2-line size-4" />
      </IconButton>
      <Collapsible>
        <CollapsibleTrigger
          render={
            <IconButton aria-label="Details">
              <span aria-hidden className="i-ri-information-2-line size-4" />
            </IconButton>
          }
        />
        <CollapsiblePanel>Build details</CollapsiblePanel>
      </Collapsible>
    </div>,
  )
  const reference = screen.getByRole('button', { name: 'Reference' })
  const trigger = screen.getByRole('button', { name: 'Details', exact: true })
  const appearance = (element: Element) => {
    const style = getComputedStyle(element)
    return {
      width: style.width,
      height: style.height,
      padding: style.padding,
      borderRadius: style.borderRadius,
      color: style.color,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
    }
  }

  await reference.hover()
  const idle = appearance(trigger.element())
  const hovered = appearance(reference.element())
  await trigger.hover()
  expect(appearance(reference.element())).toEqual(idle)
  expect(appearance(trigger.element())).toEqual(hovered)

  await reference.hover()
  await userEvent.tab()
  await expect.element(reference).toHaveFocus()
  const focused = appearance(reference.element())
  await trigger.hover()
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  expect(getComputedStyle(trigger.element()).boxShadow).not.toBe('none')
  expect(appearance(trigger.element())).toEqual(focused)
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('Build details')).toBeVisible()
})
