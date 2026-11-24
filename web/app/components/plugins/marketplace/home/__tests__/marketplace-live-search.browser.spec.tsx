import type { ReactNode } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createTestNavigation } from '@/test/next-navigation'
import MarketplaceLiveSearch from '../marketplace-live-search'

function renderSearch(ui: ReactNode) {
  const navigation = createTestNavigation({ url: '/plugins' })
  const { NavigationProvider } = navigation
  return { navigation, screen: render(<NavigationProvider>{ui}</NavigationProvider>) }
}

describe('Marketplace live search routing', () => {
  beforeEach(async () => {
    await page.viewport(1000, 700)
  })

  it('submits the trimmed query immediately and preserves the active catalog filters', async () => {
    const { navigation, screen: rendered } = renderSearch(
      <MarketplaceLiveSearch
        action="/templates/knowledge"
        language="en-US"
        placeholder="Search templates"
        preserveParams={{ languages: ['ja', 'zh-Hans'], tags: ['agent'] }}
        query=""
      />,
    )
    const screen = await rendered
    const search = screen.getByRole('searchbox', { name: 'Search templates' })

    await search.fill('  legal research  ')
    await userEvent.keyboard('{Enter}')

    await expect.poll(() => navigation.router.replace).toHaveBeenCalledOnce()
    const [href, options] = navigation.router.replace.mock.calls[0]!
    const url = new URL(href, window.location.origin)
    expect(url.pathname).toBe('/templates/knowledge')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      language: 'en-US',
      languages: 'ja,zh-Hans',
      q: 'legal research',
      tags: 'agent',
    })
    expect(options).toEqual({ scroll: false })
    await expect.element(search).toHaveValue('  legal research  ')
  })

  it('debounces typing and clears the query without leaving the active plugin tab', async () => {
    const { navigation, screen: rendered } = renderSearch(
      <MarketplaceLiveSearch action="/plugins/tool" placeholder="Search plugins" query="maps" />,
    )
    const screen = await rendered
    const search = screen.getByRole('searchbox', { name: 'Search plugins' })

    await search.fill('weather')
    expect(navigation.router.replace).not.toHaveBeenCalled()
    await expect
      .poll(() => navigation.router.replace)
      .toHaveBeenCalledExactlyOnceWith('/plugins/tool?q=weather', { scroll: false })

    await search.clear()
    await expect
      .poll(() => navigation.router.replace)
      .toHaveBeenLastCalledWith('/plugins/tool', { scroll: false })
    expect(navigation.router.replace).toHaveBeenCalledTimes(2)
    await expect.element(search).toHaveFocus()
  })
})
