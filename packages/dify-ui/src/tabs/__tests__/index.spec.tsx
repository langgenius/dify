import { render } from 'vitest-browser-react'
import {
  Tabs,
  TabsDivider,
  TabsList,
  TabsPanel,
  TabsTab,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Tabs wrappers', () => {
  it('renders Base UI tabs with accessible roles', async () => {
    const screen = await render(
      <Tabs defaultValue="js">
        <TabsList>
          <TabsTab value="js">JavaScript</TabsTab>
          <TabsTab value="py">Python</TabsTab>
        </TabsList>
        <TabsPanel value="js">JS panel</TabsPanel>
        <TabsPanel value="py">Python panel</TabsPanel>
      </Tabs>,
    )

    await expect.element(screen.getByRole('tablist')).toBeInTheDocument()
    await expect.element(screen.getByRole('tab', { name: 'JavaScript' })).toHaveAttribute('aria-selected', 'true')
    await expect.element(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'false')
    await expect.element(screen.getByText('JS panel')).toBeInTheDocument()
  })

  it('uses segmented control styling by default', async () => {
    const screen = await render(
      <Tabs defaultValue="first">
        <TabsList>
          <TabsTab value="first">First</TabsTab>
          <TabsTab value="second">Second</TabsTab>
        </TabsList>
      </Tabs>,
    )

    await expect.element(screen.getByRole('tablist')).toHaveClass(
      'bg-components-segmented-control-bg-normal',
      'p-0.5',
      'rounded-[10px]',
    )
    await expect.element(screen.getByRole('tab', { name: 'First' })).toHaveClass(
      'h-7',
      'px-2',
      'system-sm-medium',
      'data-active:text-text-accent-light-mode-only',
    )
  })

  it('calls onValueChange while leaving controlled value to the caller', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <Tabs value="js" onValueChange={onValueChange}>
        <TabsList>
          <TabsTab value="js">JavaScript</TabsTab>
          <TabsTab value="py">Python</TabsTab>
        </TabsList>
      </Tabs>,
    )

    asHTMLElement(screen.getByRole('tab', { name: 'Python' }).element()).click()

    expect(onValueChange).toHaveBeenCalledWith('py', expect.anything())
    await expect.element(screen.getByRole('tab', { name: 'JavaScript' })).toHaveAttribute('aria-selected', 'true')
  })

  it('forwards className to composable parts', async () => {
    const screen = await render(
      <Tabs defaultValue="first">
        <TabsList className="custom-list">
          <TabsTab value="first" className="custom-tab">First</TabsTab>
          <TabsDivider className="custom-divider" data-testid="divider" />
        </TabsList>
        <TabsPanel value="first" className="custom-panel">Panel</TabsPanel>
      </Tabs>,
    )

    await expect.element(screen.getByRole('tablist')).toHaveClass('custom-list')
    await expect.element(screen.getByRole('tab', { name: 'First' })).toHaveClass('custom-tab')
    await expect.element(screen.getByTestId('divider')).toHaveClass('custom-divider')
    expect(screen.getByText('Panel').element()).toHaveClass('custom-panel')
  })
})
