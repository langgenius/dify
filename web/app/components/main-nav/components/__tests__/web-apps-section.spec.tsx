import { renderToReadableStream } from 'react-dom/server.node'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import WebAppsSection from '../web-apps-section'

vi.mock('@/next/navigation', () => ({ usePathname: () => '/published-apps' }))

it.each([
  { permissions: ['app_library.access'], visible: true },
  { permissions: [], visible: false },
])('server-renders Published apps only with access: $visible', async ({ permissions, visible }) => {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: permissions,
  })
  const onError = vi.fn()
  const stream = await renderToReadableStream(
    <Wrapper>
      <WebAppsSection />
    </Wrapper>,
    { onError },
  )
  const html = await new Response(stream).text()
  if (visible) {
    expect(html).toContain('href="/published-apps"')
    expect(html).toContain('navigation.mainNav.publishedApps')
    expect(html).toContain('aria-current="page"')
  } else {
    expect(html).not.toContain('href="/published-apps"')
  }
  expect(onError).not.toHaveBeenCalled()
})
