import type { BannerResponse } from '@dify/contracts/api/console/explore/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { Banner } from '../banner'

const banner = (id: string, title: string): BannerResponse => ({
  id,
  status: 'enabled',
  link: 'https://example.com',
  created_at: '2024-01-01T00:00:00Z',
  sort: 1,
  content: {
    category: 'Featured',
    title,
    description: 'Explore Dify',
    'img-src': 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  },
})

async function setup() {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(1200, 800)
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'account-1', name: 'Evan' },
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <button type="button">Before banners</button>
      <Banner banners={[banner('first', 'First banner'), banner('second', 'Second banner')]} />
      <button type="button">After banners</button>
    </QueryClientTestProvider>,
  )
  await expect
    .element(screen.getByRole('button', { name: 'explore.banner.stopRotation' }))
    .toBeVisible()
  return screen
}

it('keeps only the selected banner keyboard-operable and preserves focus on shared pagination controls', async () => {
  const screen = await setup()
  await screen.getByRole('button', { name: 'Before banners' }).click()
  await userEvent.tab()
  await expect
    .element(screen.getByRole('button', { name: 'explore.banner.startRotation' }))
    .toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: '01 First banner' })).toHaveFocus()
  await userEvent.tab()
  const second = screen.getByRole('button', { name: '02 Second banner' })
  await expect.element(second).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(second).toHaveAttribute('aria-current', 'true')
  await expect.element(second).toHaveFocus()
  await expect.element(screen.getByRole('link', { name: 'First banner' })).not.toBeInTheDocument()
  await expect.element(screen.getByRole('link', { name: 'Second banner' })).toBeVisible()
  await userEvent.tab()
  await expect.element(screen.getByRole('link', { name: 'Second banner' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'After banners' })).toHaveFocus()
  await expect
    .element(screen.getByRole('button', { name: 'explore.banner.startRotation' }))
    .toBeVisible()
})

it('pauses real rotation on hover and preserves an explicit stop through pointer leave and resize', async () => {
  const screen = await setup()
  const outside = screen.getByRole('button', { name: 'Before banners' })
  const carousel = screen.getByRole('region', { name: 'explore.banner.carouselLabel' })
  const first = screen.getByRole('button', { name: '01 First banner' })
  const second = screen.getByRole('button', { name: '02 Second banner' })
  const announcementMode = () =>
    carousel.element().querySelector('[aria-live]')?.getAttribute('aria-live')
  await screen.getByRole('button', { name: 'explore.banner.stopRotation' }).click()
  // Start controlled time after the real Embla instance is ready and its first timer is stopped.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await screen.getByRole('button', { name: 'explore.banner.startRotation' }).click()
  await outside.hover()
  await expect.poll(announcementMode).toBe('off')
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(second).toHaveAttribute('aria-current', 'true')
  await carousel.hover()
  await expect.poll(announcementMode).toBe('polite')
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(second).toHaveAttribute('aria-current', 'true')
  await expect
    .element(screen.getByRole('button', { name: 'explore.banner.stopRotation' }))
    .toBeVisible()
  await outside.hover()
  await expect.poll(announcementMode).toBe('off')
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(first).toHaveAttribute('aria-current', 'true')
  await screen.getByRole('button', { name: 'explore.banner.stopRotation' }).click()
  await outside.hover()
  await page.viewport(1000, 800)
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(first).toHaveAttribute('aria-current', 'true')
  await expect
    .element(screen.getByRole('button', { name: 'explore.banner.startRotation' }))
    .toBeVisible()
  await expect.poll(announcementMode).toBe('polite')
})
