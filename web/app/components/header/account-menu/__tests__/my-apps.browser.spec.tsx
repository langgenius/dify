import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import AccountMenu from '../index'

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  APP_WEB_URL: 'https://webapp.example.com/',
}))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  basePath: '/dify',
}))
vi.mock('@/service/use-common', () => ({ useLogout: () => ({ mutate: vi.fn() }) }))
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

it('places My apps last and links to the WebApp domain with the deployment base path', async () => {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    accountProfile: { name: 'Current User', email: 'current@example.com' },
    features: { education: { enabled: false } },
  })
  const { wrapper: NuqsProvider } = createNuqsTestWrapper()
  const screen = await render(
    <ConsoleProvider>
      <NuqsProvider>
        <AccountMenu
          trigger={({ ariaLabel }) => (
            <button type="button" aria-label={ariaLabel}>
              Account
            </button>
          )}
        />
      </NuqsProvider>
    </ConsoleProvider>,
  )

  await screen.getByRole('button', { name: 'accountSettings.account.account' }).click()
  const myApps = screen.getByRole('menuitem', { name: 'app.endUser.myApps' })
  await expect.element(myApps).toBeVisible()
  await expect.element(myApps).toHaveAttribute('href', 'https://webapp.example.com/dify/my-apps')
  await expect.element(screen.getByRole('menuitem').last()).toHaveTextContent('app.endUser.myApps')
})
