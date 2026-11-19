import { useRef, useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { InfiniteScrollSentinel } from '..'

const viewportPreload = (container: Element) => container.clientHeight

function Feed({
  preloadDistance = 160,
  owner = 'Original',
}: {
  preloadDistance?: number | ((container: Element) => number)
  owner?: string
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canLoadMore, setCanLoadMore] = useState(true)
  const [loaded, setLoaded] = useState<string[]>([])
  return (
    <>
      <button type="button" onClick={() => setCanLoadMore((value) => !value)}>
        {canLoadMore ? 'Pause loading' : 'Resume loading'}
      </button>
      <output aria-label="Loaded pages">{loaded.join(', ') || 'No pages loaded'}</output>
      <div
        ref={scrollContainerRef}
        role="region"
        aria-label="Feed"
        style={{ height: 200, width: 400, overflow: 'auto' }}
      >
        <div style={{ height: 1200 }}>Earlier results</div>
        <InfiniteScrollSentinel
          scrollContainerRef={scrollContainerRef}
          canLoadMore={canLoadMore}
          preloadDistance={preloadDistance}
          onLoadMore={() => setLoaded((pages) => [...pages, owner])}
        />
        <div style={{ height: 400 }}>Later results</div>
      </div>
    </>
  )
}

it.each([
  { name: 'fixed', preloadDistance: 160 },
  { name: 'viewport-sized', preloadDistance: viewportPreload },
])(
  'loads before the sentinel is visible using a $name preload distance',
  async ({ preloadDistance }) => {
    await page.viewport(1000, 800)
    const screen = await render(<Feed preloadDistance={preloadDistance} />)
    const feed = screen.getByRole('region', { name: 'Feed' })
    const pages = screen.getByRole('status', { name: 'Loaded pages' })
    await expect.element(feed).toBeVisible()
    await expect.element(pages).toHaveTextContent('No pages loaded')
    // The sentinel starts at 1200px, below the native 200px viewport even after scrolling.
    feed.element().scrollTo({ top: 850 })
    await expect.element(pages).toHaveTextContent('Original')
    expect(feed.element().scrollTop + feed.element().clientHeight).toBeLessThan(1200)
  },
)

it('pauses intersection loading and resumes with the current callback owner', async () => {
  await page.viewport(1000, 800)
  const screen = await render(<Feed />)
  await screen.getByRole('button', { name: 'Pause loading' }).click()
  const feed = screen.getByRole('region', { name: 'Feed' })
  const pages = screen.getByRole('status', { name: 'Loaded pages' })
  feed.element().scrollTo({ top: 1200 })
  // A rendered frame settles the native intersection while loading is disabled.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
  await expect.element(pages).toHaveTextContent('No pages loaded')
  await screen.rerender(<Feed owner="Replacement" />)
  await screen.getByRole('button', { name: 'Resume loading' }).click()
  await expect.element(pages).toHaveTextContent('Replacement')
})

it('uses a replacement callback when the same observed feed enters the preload area again', async () => {
  await page.viewport(1000, 800)
  const screen = await render(<Feed />)
  const feed = screen.getByRole('region', { name: 'Feed' })
  const pages = screen.getByRole('status', { name: 'Loaded pages' })
  await expect.element(feed).toBeVisible()
  feed.element().scrollTo({ top: 850 })
  await expect.element(pages).toHaveTextContent('Original')
  feed.element().scrollTo({ top: 0 })
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
  await screen.rerender(<Feed owner="Replacement" />)
  feed.element().scrollTo({ top: 850 })
  await expect.element(pages).toHaveTextContent('Original, Replacement')
})
