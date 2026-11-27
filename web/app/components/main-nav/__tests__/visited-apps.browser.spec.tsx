import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { MainNavFooter } from '../index'

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  basePath: '/dify',
}))
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

it.each([
  ['https://webapp.example.com/web-prefix', 'https://webapp.example.com/web-prefix/my-apps'],
  ['/web-prefix', '/web-prefix/my-apps'],
  ['', '/my-apps'],
])(
  'opens Visited apps outside the account menu using the runtime prefix %s',
  async (webappUrl, expectedHref) => {
    onTestFinished(guardUnexpectedFetch())
    const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
      accountProfile: { name: 'Current User', email: 'current@example.com' },
      features: { education: { enabled: false } },
      systemFeatures: { webapp_account_login_enabled: true, webapp_url: webappUrl },
    })
    const { wrapper: NuqsProvider } = createNuqsTestWrapper()
    const screen = await render(
      <ConsoleProvider>
        <NuqsProvider>
          <MainNavFooter />
        </NuqsProvider>
      </ConsoleProvider>,
    )

    const visitedApps = screen.getByRole('link', { name: 'navigation.mainNav.visitedApps' })
    await expect.element(visitedApps).toBeVisible()
    await expect.element(visitedApps).toHaveAttribute('href', expectedHref)
    await expect.element(visitedApps).toHaveAttribute('target', '_blank')
    await expect.element(visitedApps).toHaveAttribute('rel', 'noopener noreferrer')

    await screen.getByRole('button', { name: /accountSettings.account.account/ }).click()
    await expect.element(screen.getByRole('menu')).toBeVisible()
    await expect
      .element(screen.getByRole('menuitem', { name: 'app.endUser.myApps' }))
      .not.toBeInTheDocument()
    await expect.element(visitedApps).toBeVisible()
  },
)

it('hides Visited apps when WebApp Account login is disabled', async () => {
  onTestFinished(guardUnexpectedFetch())
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    accountProfile: { name: 'Current User', email: 'current@example.com' },
    features: { education: { enabled: false } },
    systemFeatures: {
      webapp_account_login_enabled: false,
      webapp_url: 'https://webapp.example.com',
    },
  })
  const { wrapper: NuqsProvider } = createNuqsTestWrapper()
  const screen = await render(
    <ConsoleProvider>
      <NuqsProvider>
        <MainNavFooter />
      </NuqsProvider>
    </ConsoleProvider>,
  )

  await expect
    .element(screen.getByRole('button', { name: /accountSettings.account.account/ }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('navigation', { name: 'navigation.mainNav.visitedApps' }))
    .not.toBeInTheDocument()
})
