import type { Plugin } from '@/app/components/plugins/types'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import List from '../index'

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: {} }),
}))

const plugins = Array.from({ length: 5 }, (_, index) => ({
  plugin_id: `publisher/plugin-${index}`,
  org: 'publisher',
  name: `Plugin ${index + 1}`,
})) as Plugin[]

describe('Marketplace search result layout', () => {
  // Native grid layout determines whether the result cards remain readable;
  // happy-dom cannot reproduce the four 75px columns seen on mobile.
  it('keeps readable single-column cards at a 390px viewport', async () => {
    await page.viewport(390, 844)
    const screen = await render(
      <div style={{ width: 350 }}>
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={plugins}
          cardRender={(plugin) => (
            <a key={plugin.plugin_id} href={`/plugin/${plugin.plugin_id}`}>
              {plugin.name}
            </a>
          )}
        />
      </div>,
    )

    const first = screen.getByRole('link', { name: 'Plugin 1' }).element().getBoundingClientRect()
    const nextRow = screen.getByRole('link', { name: 'Plugin 2' }).element().getBoundingClientRect()

    expect(first.width).toBeGreaterThanOrEqual(250)
    expect(nextRow.top).toBeGreaterThanOrEqual(first.bottom)
  })
})
