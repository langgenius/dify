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
  it.each([
    { viewportWidth: 390, columns: 1 },
    { viewportWidth: 1280, columns: 4 },
  ])('keeps readable cards at $viewportWidth px', async ({ viewportWidth, columns }) => {
    await page.viewport(viewportWidth, 844)
    const screen = await render(
      <div style={{ width: viewportWidth - 40 }}>
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
    const nextRow = screen
      .getByRole('link', { name: `Plugin ${columns + 1}` })
      .element()
      .getBoundingClientRect()

    expect(first.width).toBeGreaterThanOrEqual(250)
    expect(nextRow.top).toBeGreaterThanOrEqual(first.bottom)
    if (columns > 1) {
      const lastInRow = screen
        .getByRole('link', { name: `Plugin ${columns}` })
        .element()
        .getBoundingClientRect()
      expect(lastInRow.top).toBe(first.top)
    }
  })
})
