import type { ReactNode } from 'react'
import { Provider as JotaiProvider } from 'jotai'
import { render } from 'vitest-browser-react'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Description from '../index'

// The real Motion spring must collapse and restore the hero without hiding its navigation.
it('keeps marketplace navigation usable while scrolling the animated hero', async () => {
  const onNavigate = vi.fn()
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <NuqsWrapper>{children}</NuqsWrapper>
    </JotaiProvider>
  )
  const screen = await render(
    <section
      aria-label="Marketplace content"
      id="animated-marketplace"
      style={{ height: 400, overflowY: 'auto' }}
    >
      <Description
        isMarketplacePlatform
        scrollContainerId="animated-marketplace"
        marketplaceNav={
          <nav aria-label="Marketplace navigation" className="relative z-20">
            <button type="button" onClick={onNavigate}>
              Marketplace action
            </button>
          </nav>
        }
      />
      <div style={{ height: 1000 }} />
    </section>,
    { wrapper },
  )
  const container = screen.getByRole('region', { name: 'Marketplace content' }).element()
  const heading = screen.getByRole('heading', { level: 1 })
  const navigation = screen.getByRole('navigation', { name: 'Marketplace navigation' })
  const filters = screen.getByRole('group', { name: 'plugin.allCategories' })
  await expect.element(heading).toBeVisible()
  const navigationTop = navigation.element().getBoundingClientRect().top
  const expandedFiltersTop = filters.element().getBoundingClientRect().top
  const headingHeight = heading.element().getBoundingClientRect().height

  container.scrollTop = 240
  await expect
    .poll(() => filters.element().getBoundingClientRect().top)
    .toBeLessThan(expandedFiltersTop - headingHeight)
  await expect.element(navigation).toBeVisible()
  expect(navigation.element().getBoundingClientRect().top).toBeCloseTo(navigationTop, 0)
  await screen.getByRole('button', { name: 'Marketplace action' }).click()
  expect(onNavigate).toHaveBeenCalledOnce()

  container.scrollTop = 0
  await expect
    .poll(() => filters.element().getBoundingClientRect().top)
    .toBeCloseTo(expandedFiltersTop, 0)
  await expect.element(heading).toBeVisible()
  await expect.element(navigation).toBeVisible()
})
