import { render } from 'vitest-browser-react'
import { Tabs, TabsList, TabsPanel, TabsTab } from '../index'

describe('Tabs wrappers', () => {
  it('forwards className to composable parts', async () => {
    const screen = await render(
      <Tabs defaultValue="first">
        <TabsList className="custom-list">
          <TabsTab value="first" className="custom-tab">
            First
          </TabsTab>
        </TabsList>
        <TabsPanel value="first" className="custom-panel">
          Panel
        </TabsPanel>
      </Tabs>,
    )

    await expect.element(screen.getByRole('tablist')).toHaveClass('custom-list')
    await expect.element(screen.getByRole('tab', { name: 'First' })).toHaveClass('custom-tab')
    expect(screen.getByText('Panel').element()).toHaveClass('custom-panel')
  })
})
