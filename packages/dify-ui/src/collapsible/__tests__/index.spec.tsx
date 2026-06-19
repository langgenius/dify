import { render } from 'vitest-browser-react'
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Collapsible wrappers', () => {
  it('renders the Base UI anatomy with an accessible trigger', async () => {
    const screen = await render(
      <CollapsibleRoot defaultOpen data-testid="collapsible-root">
        <CollapsibleTrigger>Recovery keys</CollapsibleTrigger>
        <CollapsiblePanel>Panel content</CollapsiblePanel>
      </CollapsibleRoot>,
    )

    await expect.element(screen.getByTestId('collapsible-root')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Recovery keys' })).toHaveAttribute('data-panel-open', '')
    await expect.element(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('toggles open state through the trigger without caller-owned state', async () => {
    const screen = await render(
      <CollapsibleRoot>
        <CollapsibleTrigger>Toggle section</CollapsibleTrigger>
        <CollapsiblePanel>Hidden content</CollapsiblePanel>
      </CollapsibleRoot>,
    )
    const trigger = screen.getByRole('button', { name: 'Toggle section' })

    await expect.element(trigger).not.toHaveAttribute('data-panel-open')

    asHTMLElement(trigger.element()).click()

    await expect.element(trigger).toHaveAttribute('data-panel-open', '')
    await expect.element(screen.getByText('Hidden content')).toBeInTheDocument()
  })

  it('forwards className to every compound part', async () => {
    const screen = await render(
      <CollapsibleRoot defaultOpen className="custom-root">
        <CollapsibleTrigger className="custom-trigger">Custom</CollapsibleTrigger>
        <CollapsiblePanel className="custom-panel">Custom panel</CollapsiblePanel>
      </CollapsibleRoot>,
    )

    await expect.element(screen.getByRole('button', { name: 'Custom' })).toHaveClass('custom-trigger')
    expect(screen.getByText('Custom panel').element()).toHaveClass('custom-panel')
    expect(screen.container.querySelector('.custom-root')).toBeInTheDocument()
  })

  it('passes Base UI panel props through to the panel', async () => {
    const screen = await render(
      <CollapsibleRoot defaultOpen>
        <CollapsibleTrigger>Styled trigger</CollapsibleTrigger>
        <CollapsiblePanel keepMounted>Styled panel</CollapsiblePanel>
      </CollapsibleRoot>,
    )

    await expect.element(screen.getByRole('button', { name: 'Styled trigger' })).toHaveAttribute('data-panel-open', '')
    await expect.element(screen.getByText('Styled panel')).toBeInTheDocument()
  })

  it('applies Dify disclosure defaults without a pressed active style', async () => {
    const screen = await render(
      <CollapsibleRoot defaultOpen>
        <CollapsibleTrigger>Styled trigger</CollapsibleTrigger>
        <CollapsiblePanel>Styled panel</CollapsiblePanel>
      </CollapsibleRoot>,
    )
    const trigger = screen.getByRole('button', { name: 'Styled trigger' }).element()
    const panel = screen.getByText('Styled panel').element()

    expect(trigger).toHaveClass(
      'hover:not-data-disabled:bg-components-panel-on-panel-item-bg-hover',
      'focus-visible:ring-2',
      'focus-visible:ring-state-accent-solid',
      'data-panel-open:text-text-primary',
    )
    expect(trigger.className).not.toContain('active:')
    expect(panel).toHaveClass(
      'h-(--collapsible-panel-height)',
      'data-ending-style:h-0',
      'data-starting-style:h-0',
    )
  })
})
