import { render } from 'vitest-browser-react'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '../index'

describe('Collapsible wrappers', () => {
  it('forwards className to every compound part', async () => {
    const screen = await render(
      <Collapsible defaultOpen className="custom-root">
        <CollapsibleTrigger className="custom-trigger">Custom</CollapsibleTrigger>
        <CollapsiblePanel className="custom-panel">Custom panel</CollapsiblePanel>
      </Collapsible>,
    )

    await expect
      .element(screen.getByRole('button', { name: 'Custom' }))
      .toHaveClass('custom-trigger')
    expect(screen.getByText('Custom panel').element()).toHaveClass('custom-panel')
    expect(screen.container.querySelector('.custom-root')).toBeInTheDocument()
  })

  it('keeps closed panel content mounted when requested', async () => {
    const screen = await render(
      <Collapsible>
        <CollapsibleTrigger>Recovery options</CollapsibleTrigger>
        <CollapsiblePanel keepMounted>Recovery codes</CollapsiblePanel>
      </Collapsible>,
    )

    await expect
      .element(screen.getByRole('button', { name: 'Recovery options' }))
      .toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByText('Recovery codes')).toBeInTheDocument()
    await expect.element(screen.getByText('Recovery codes')).not.toBeVisible()
  })
})
