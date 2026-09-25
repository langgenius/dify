import * as React from 'react'
import { createPortal } from 'react-dom'
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
        {createPortal(
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
})
