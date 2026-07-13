import { render } from 'vitest-browser-react'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Collapsible wrappers', () => {
  it('renders the Base UI anatomy with an accessible trigger', async () => {
    const screen = await render(
      <Collapsible defaultOpen data-testid="collapsible-root">
        <CollapsibleTrigger>Recovery keys</CollapsibleTrigger>
        <CollapsiblePanel>Panel content</CollapsiblePanel>
      </Collapsible>,
    )

    await expect.element(screen.getByTestId('collapsible-root')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Recovery keys' }))
      .toHaveAttribute('data-panel-open', '')
    await expect.element(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('toggles open state through the trigger without caller-owned state', async () => {
    const screen = await render(
      <Collapsible>
        <CollapsibleTrigger>Toggle section</CollapsibleTrigger>
        <CollapsiblePanel>Hidden content</CollapsiblePanel>
      </Collapsible>,
    )
    const trigger = screen.getByRole('button', { name: 'Toggle section' })

    await expect.element(trigger).not.toHaveAttribute('data-panel-open')

    asHTMLElement(trigger.element()).click()

    await expect.element(trigger).toHaveAttribute('data-panel-open', '')
    await expect.element(screen.getByText('Hidden content')).toBeInTheDocument()
  })

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

  it('passes Base UI panel props through to the panel', async () => {
    const screen = await render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Styled trigger</CollapsibleTrigger>
        <CollapsiblePanel keepMounted>Styled panel</CollapsiblePanel>
      </Collapsible>,
    )

    await expect
      .element(screen.getByRole('button', { name: 'Styled trigger' }))
      .toHaveAttribute('data-panel-open', '')
    await expect.element(screen.getByText('Styled panel')).toBeInTheDocument()
  })
})
