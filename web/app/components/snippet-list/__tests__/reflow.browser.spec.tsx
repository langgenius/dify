import { cn } from '@langgenius/dify-ui/cn'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { StudioListHeader } from '@/app/components/apps/studio-list-header'
import {
  MAIN_NAV_DESKTOP_CLASS_NAME,
  MAIN_NAV_LAYOUT_CLASS_NAME,
  MAIN_NAV_MOBILE_HEADER_CLASS_NAME,
} from '@/app/components/main-nav/responsive-classes'
import {
  SNIPPET_LIST_FILTER_GROUP_CLASS_NAME,
  SNIPPET_LIST_GRID_CLASS_NAME,
  SNIPPET_LIST_SEARCH_CLASS_NAME,
} from '../constants'

function SnippetReflowHarness() {
  return (
    <section className={cn(MAIN_NAV_LAYOUT_CLASS_NAME, 'h-dvh w-full')} aria-label="Page shell">
      <aside
        aria-label="Desktop navigation"
        className={cn(MAIN_NAV_DESKTOP_CLASS_NAME, 'h-full w-62 shrink-0')}
      />
      <header
        role="banner"
        aria-label="Mobile navigation"
        className={MAIN_NAV_MOBILE_HEADER_CLASS_NAME}
      />
      <main className="flex min-h-0 min-w-0 grow flex-col overflow-hidden">
        <div className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto">
          <StudioListHeader title={<h1>Snippets</h1>}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={SNIPPET_LIST_FILTER_GROUP_CLASS_NAME}>
                <button type="button">Creators</button>
                <button type="button">Status</button>
                <button type="button">Tags</button>
                <div className={SNIPPET_LIST_SEARCH_CLASS_NAME} role="search">
                  Search
                </div>
              </div>
              <button type="button">Create</button>
            </div>
          </StudioListHeader>
          <section aria-label="Snippet cards" className={SNIPPET_LIST_GRID_CLASS_NAME}>
            <article className="h-40 w-full" aria-label="Snippet card" />
          </section>
        </div>
      </main>
    </section>
  )
}

describe('Snippet list reflow', () => {
  afterEach(async () => {
    await page.viewport(1280, 720)
  })

  it('keeps navigation, filters, and cards overflow-free at 320 CSS pixels', async () => {
    // Chromium owns media-query resolution and layout geometry; happy-dom cannot prove reflow.
    await page.viewport(320, 800)
    const screen = await render(<SnippetReflowHarness />)
    const shell = screen.getByRole('region', { name: 'Page shell' }).element()
    const main = screen.getByRole('main').element()
    const search = screen.getByRole('search').element()
    const grid = screen.getByRole('region', { name: 'Snippet cards' }).element()
    const card = screen.getByRole('article', { name: 'Snippet card' }).element()
    const desktopNavigation = shell.querySelector<HTMLElement>('[aria-label="Desktop navigation"]')
    if (!desktopNavigation) throw new Error('Desktop navigation was not rendered')

    await expect.element(screen.getByRole('banner', { name: 'Mobile navigation' })).toBeVisible()
    expect(getComputedStyle(desktopNavigation).display).toBe('none')
    expect(shell.scrollWidth).toBe(shell.clientWidth)
    expect(search.getBoundingClientRect().right).toBeLessThanOrEqual(
      main.getBoundingClientRect().right,
    )
    expect(grid.scrollWidth).toBe(grid.clientWidth)
    expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(grid.clientWidth)
  })
})
