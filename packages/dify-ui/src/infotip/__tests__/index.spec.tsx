import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { render } from 'vitest-browser-react'
import { Infotip, InfotipContent, InfotipTrigger } from '..'

describe('Infotip composition', () => {
  it('preserves caller handlers and prevents an enclosing action from firing', async () => {
    const parentClick = vi.fn()
    const triggerClick = vi.fn()
    const triggerRef = React.createRef<HTMLButtonElement>()
    const screen = await render(
      <button type="button" onClick={parentClick}>
        Parent action
        {ReactDOM.createPortal(
          <Infotip>
            <InfotipTrigger aria-label="Details" onClick={triggerClick} ref={triggerRef} />
            <InfotipContent aria-label="Details">Explanation</InfotipContent>
          </Infotip>,
          document.body,
        )}
      </button>,
    )
    await screen.getByRole('button', { name: 'Details' }).click()
    await expect
      .element(screen.getByRole('dialog', { name: 'Details' }))
      .toHaveTextContent('Explanation')
    expect(triggerRef.current?.tagName).toBe('BUTTON')
    expect(triggerClick).toHaveBeenCalledOnce()
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('lets a caller cancel opening without losing trigger event composition', async () => {
    const onOpenChange = vi.fn()
    const screen = await render(
      <Infotip onOpenChange={onOpenChange}>
        <InfotipTrigger
          aria-label="Unavailable details"
          openOnHover={false}
          onClick={(event) => event.preventBaseUIHandler()}
        />
        <InfotipContent aria-label="Details">Explanation</InfotipContent>
      </Infotip>,
    )
    await screen.getByRole('button', { name: 'Unavailable details' }).click()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it.each([
    ['sm', 12, 12],
    ['md', 16, 14],
    ['lg', 16, 16],
  ] as const)(
    'keeps the %s layout box while accepting a 24px pointer target',
    async (size, box, icon) => {
      const screen = await render(
        <div className="p-6">
          <Infotip>
            <InfotipTrigger aria-label="Details" size={size} openOnHover={false} />
            <InfotipContent aria-label="Details">Explanation</InfotipContent>
          </Infotip>
        </div>,
      )
      const trigger = screen.getByRole('button', { name: 'Details' }).element()
      const rect = trigger.getBoundingClientRect()
      expect(rect.width).toBe(box)
      expect(rect.height).toBe(box)
      expect(trigger.firstElementChild?.getBoundingClientRect().width).toBe(icon)

      const target = getComputedStyle(trigger, '::before')
      expect(target.width).toBe('24px')
      expect(target.height).toBe('24px')

      const edge = document.elementFromPoint(rect.left - (24 - box) / 2 + 1, rect.top + box / 2)
      expect(edge).toBe(trigger)
    },
  )

  it('keeps the pointer target when a caller positions the trigger absolutely', async () => {
    const screen = await render(
      <div className="relative m-6 h-8 w-32">
        <Infotip>
          <InfotipTrigger
            aria-label="Details"
            className="absolute end-1 top-1/2 -translate-y-1/2"
            openOnHover={false}
          />
          <InfotipContent aria-label="Details">Explanation</InfotipContent>
        </Infotip>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'Details' }).element()
    expect(getComputedStyle(trigger).position).toBe('absolute')
    const rect = trigger.getBoundingClientRect()
    expect(document.elementFromPoint(rect.right + 3, rect.top + rect.height / 2)).toBe(trigger)
    expect(document.elementFromPoint(rect.left + rect.width / 2, rect.top - 3)).toBe(trigger)
  })
})
