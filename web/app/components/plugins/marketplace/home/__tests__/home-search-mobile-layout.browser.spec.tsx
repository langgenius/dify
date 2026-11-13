import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MARKETPLACE_CONTAINER_ID } from '../../constants'
import HomeHeader from '../home-header'
import HomeSearch from '../home-search'
import { HomeShell } from '../home-shell'

const renderMarketplaceHome = () =>
  render(
    <div id={MARKETPLACE_CONTAINER_ID} style={{ height: 320, overflowY: 'auto' }}>
      <HomeShell
        banners={[]}
        header={
          <HomeHeader actions={<button type="button">Sign in</button>} isMarketplacePlatform />
        }
        hero={<div aria-hidden style={{ height: 180, flexShrink: 0 }} />}
        isMarketplacePlatform
        navigation={<div aria-hidden style={{ height: 80, flexShrink: 0 }} />}
        page="plugins"
        search={
          <HomeSearch enableSearchShortcut={false}>
            <input
              aria-label="Search plugins or templates"
              style={{ display: 'block', height: 36, width: '100%' }}
            />
          </HomeSearch>
        }
      >
        <div aria-hidden style={{ height: 640, flexShrink: 0 }} />
      </HomeShell>
    </div>,
  )

describe('Marketplace mobile search layout', () => {
  it('pins the mobile search below the header without covering brand or actions', async () => {
    await page.viewport(390, 844)
    const screen = await renderMarketplaceHome()

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    await expect.element(screen.getByRole('banner')).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Search plugins or templates' }))
      .toBeVisible()
    const header = screen.getByRole('banner').element()
    const brand = screen.getByRole('link', { name: 'Dify Marketplace' }).element()
    const signIn = screen.getByRole('button', { name: 'Sign in' }).element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    scrollContainer.scrollTo({ top: 400 })
    await expect.poll(() => scrollContainer.scrollTop).toBe(400)

    // The field must occupy the row below the header, with its controls still operable.
    await expect
      .poll(() => searchInput.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom - 1)
    expect(searchInput.getBoundingClientRect().top).toBeLessThanOrEqual(
      header.getBoundingClientRect().bottom + 2,
    )
    for (const target of [brand, signIn]) {
      const bounds = target.getBoundingClientRect()
      expect(
        target.contains(
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        ),
      ).toBe(true)
    }
    const signInButton = screen.getByRole('button', { name: 'Sign in' })
    await signInButton.click()
    await expect.element(signInButton).toHaveFocus()
    const search = screen.getByRole('textbox', { name: 'Search plugins or templates' })
    await search.click()
    await userEvent.keyboard('knowledge')
    await expect.element(search).toHaveValue('knowledge')
    await expect.element(search).toHaveFocus()
  })

  it('keeps a search-results search below the header when there is no hero to overlap', async () => {
    await page.viewport(1280, 900)
    const screen = await render(
      <div id={MARKETPLACE_CONTAINER_ID} style={{ height: 320, overflowY: 'auto' }}>
        <HomeShell
          banners={[]}
          header={
            <HomeHeader actions={<button type="button">Sign in</button>} isMarketplacePlatform />
          }
          hero={null}
          isMarketplacePlatform
          navigation={null}
          page="plugins"
          search={
            <HomeSearch enableSearchShortcut={false} overlapHero={false}>
              <input
                aria-label="Search plugins or templates"
                style={{ display: 'block', height: 36, width: '100%' }}
              />
            </HomeSearch>
          }
        >
          <div aria-hidden style={{ height: 640, flexShrink: 0 }} />
        </HomeShell>
      </div>,
    )

    await expect.element(screen.getByRole('banner')).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Search plugins or templates' }))
      .toBeVisible()
    const header = screen.getByRole('banner').element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    expect(searchInput.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.getBoundingClientRect().bottom - 1,
    )
    const search = screen.getByRole('textbox', { name: 'Search plugins or templates' })
    await search.click()
    await userEvent.keyboard('search results')
    await expect.element(search).toHaveValue('search results')
    await expect.element(search).toHaveFocus()
  })

  it('does not jump the page when the stuck desktop search is focused or typed into', async () => {
    await page.viewport(1280, 900)
    const screen = await renderMarketplaceHome()

    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)!
    await expect.element(screen.getByRole('banner')).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Search plugins or templates' }))
      .toBeVisible()
    const header = screen.getByRole('banner').element()
    const searchInput = screen
      .getByRole('textbox', { name: 'Search plugins or templates' })
      .element()

    scrollContainer.scrollTo({ top: 400 })
    await expect.poll(() => scrollContainer.scrollTop).toBe(400)

    const scrollTopBefore = scrollContainer.scrollTop
    const inputTopBefore = searchInput.getBoundingClientRect().top
    expect(inputTopBefore).toBeGreaterThanOrEqual(header.getBoundingClientRect().top)
    expect(searchInput.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      header.getBoundingClientRect().bottom,
    )

    const searchLocator = screen.getByRole('textbox', { name: 'Search plugins or templates' })
    await searchLocator.click()
    await expect.element(searchLocator).toHaveFocus()

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
    expect(searchInput.getBoundingClientRect().top).toBeCloseTo(inputTopBefore)

    await userEvent.keyboard('knowledge')
    await expect.element(searchLocator).toHaveValue('knowledge')
    await expect.element(searchLocator).toHaveFocus()

    expect(scrollContainer.scrollTop).toBe(scrollTopBefore)
    expect(searchInput.getBoundingClientRect().top).toBeCloseTo(inputTopBefore)
  })
})
