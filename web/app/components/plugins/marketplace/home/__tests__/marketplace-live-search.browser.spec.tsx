import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import MarketplaceLiveSearch from '../marketplace-live-search'

const router = vi.hoisted(() => ({
  replace: vi.fn((href: string) => window.history.replaceState(null, '', href)),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => router,
}))

describe('Marketplace live search routing', () => {
  beforeEach(async () => {
    await page.viewport(1000, 700)
    window.history.replaceState(null, '', '/plugins')
    vi.clearAllMocks()
  })

  it('submits the trimmed query immediately and preserves the active catalog filters', async () => {
    const screen = await render(
      <MarketplaceLiveSearch
        action="/templates/knowledge"
        language="en-US"
        placeholder="Search templates"
        preserveParams={{ languages: ['ja', 'zh-Hans'], tags: ['agent'] }}
        query=""
      />,
    )
    const search = screen.getByRole('searchbox', { name: 'Search templates' })

    await search.fill('  legal research  ')
    await userEvent.keyboard('{Enter}')

    await expect.poll(() => window.location.pathname).toBe('/templates/knowledge')
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      language: 'en-US',
      languages: 'ja,zh-Hans',
      q: 'legal research',
      tags: 'agent',
    })
    await expect.element(search).toHaveValue('  legal research  ')

    expect(router.replace).toHaveBeenCalledOnce()
  })

  it('debounces typing and clears the query without leaving the active plugin tab', async () => {
    const screen = await render(
      <MarketplaceLiveSearch action="/plugins/tool" placeholder="Search plugins" query="maps" />,
    )
    const search = screen.getByRole('searchbox', { name: 'Search plugins' })

    await search.fill('weather')
    expect(window.location.pathname).toBe('/plugins')
    await expect.poll(() => window.location.pathname).toBe('/plugins/tool')
    expect(new URLSearchParams(window.location.search).get('q')).toBe('weather')

    await search.clear()
    await expect.poll(() => window.location.search).toBe('')
    expect(window.location.pathname).toBe('/plugins/tool')
    await expect.element(search).toHaveFocus()
  })
})
