import { Suspense } from 'react'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import WebAppsSection from '../web-apps-section'

vi.mock('@/next/navigation', () => ({ usePathname: () => '/published-apps' }))

async function renderSection(permissions = ['app_library.access']) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: permissions,
  })
  return render(
    <Wrapper>
      <Suspense fallback={null}>
        <WebAppsSection />
      </Suspense>
    </Wrapper>,
  )
}

it('opens Published apps through one destination link instead of an inline application list', async () => {
  const screen = await renderSection()
  const link = screen.getByRole('link', { name: 'navigation.mainNav.publishedApps' })
  await expect.element(link).toBeVisible()
  await expect.element(link).toHaveAttribute('href', '/published-apps')
  await expect.element(link).toHaveAttribute('aria-current', 'page')
  await expect.element(screen.getByRole('searchbox')).not.toBeInTheDocument()
})

it('does not expose Published apps without app library access', async () => {
  const screen = await renderSection([])
  await expect
    .element(screen.getByRole('link', { name: 'navigation.mainNav.publishedApps' }))
    .not.toBeInTheDocument()
})
