import { Suspense } from 'react'
import { renderToReadableStream } from 'react-dom/server.node'
import WebAppsSection from '../web-apps-section'

it('leaves only the published apps fallback on the server without running client providers', async () => {
  const onError = vi.fn()
  const onBrowserBailout = vi.fn()
  const stream = await renderToReadableStream(
    <>
      <nav aria-label="Primary">Studio</nav>
      <Suspense fallback={<span>Published apps fallback</span>}>
        <WebAppsSection />
      </Suspense>
    </>,
    { onError, onBrowserBailout },
  )
  const html = await new Response(stream).text()
  expect(html).toContain('<nav aria-label="Primary">Studio</nav>')
  expect(html).toContain('<span>Published apps fallback</span>')
  expect(onError).not.toHaveBeenCalled()
  expect(onBrowserBailout).toHaveBeenCalledOnce()
})
