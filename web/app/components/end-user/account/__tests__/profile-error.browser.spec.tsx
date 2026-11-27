import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { apiError, route, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import EndUserLayout from '../../layout'
import Account from '../index'

const profileError = 'Profile unavailable.'
const fake = setupFakeApi({
  routes: [
    route('GET', 'public', '/account/profile', () => {
      throw apiError({ status: 503, message: profileError })
    }),
    route('GET', 'public', '/system-features', () => createSystemFeaturesFixture()),
  ],
})

it('shows a failed profile request in a toast without an inline error or Retry', async () => {
  const client = createTestQueryClient()
  onTestFinished(() => {
    client.clear()
    toast.dismiss()
  })
  const screen = await render(
    <QueryClientProvider client={client}>
      <AppToaster timeout={0} />
      <EndUserLayout>
        <Account />
      </EndUserLayout>
    </QueryClientProvider>,
    { wrapper: createTestNavigation({ url: '/my-account' }).NavigationProvider },
  )

  await expect.element(screen.getByRole('dialog', { name: profileError })).toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.retry' }))
    .not.toBeInTheDocument()

  await screen.getByRole('button', { name: 'app.endUser.account' }).click()
  const menu = screen.getByRole('menu')
  await expect.element(menu).toBeVisible()
  await expect.element(menu.getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(menu.getByRole('menuitem', { name: 'common.operation.retry' }))
    .not.toBeInTheDocument()
  expect(fake.route('GET', 'public', '/account/profile')).toHaveBeenCalledOnce()
})
