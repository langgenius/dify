import type { CollectionPluginsResponse } from '@dify/contracts/marketplace'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createErrorToastCaches } from '@/app/query-error-toast'
import { marketplaceLinks } from '@/features/marketplace/links'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, setupFakeApi } from '@/test/fake-api'
import InstallFromMarketplace from '../install-from-marketplace'

const collectionLoad = { current: createDeferred<CollectionPluginsResponse>() }

const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      current: {
        plugin: {
          permission: {
            fetch: {
              get: () => ({ install_permission: 'everyone', debug_permission: 'everyone' }),
            },
          },
          installedIds: { get: () => ({ plugin_ids: [] }) },
          list: { installations: { ids: { post: () => ({ plugins: [] }) } } },
        },
      },
    },
  },
  marketplace: {
    collectionPlugins: () => collectionLoad.current.promise,
    searchAdvanced: () => ({ data: { plugins: [], total: 0 } }),
  },
}))

beforeEach(() => {
  collectionLoad.current = createDeferred<CollectionPluginsResponse>()
})

async function renderPanel() {
  const { wrapper: Providers } = createConsoleQueryWrapper({
    // Failed reads nothing on screen shows are reported by the app's query cache.
    queryClient: createConsoleQueryClient({ caches: createErrorToastCaches() }),
  })
  const screen = await render(
    <Providers>
      <InstallFromMarketplace marketplace={marketplaceLinks} providers={[]} searchText="" />
      <AppToaster />
    </Providers>,
  )
  const toggle = screen.getByRole('button', { name: /installDataSource/ })
  await expect.poll(() => fake.marketplace.collectionPlugins).toHaveBeenCalledOnce()
  return { screen, toggle }
}

it('shows a failed load inline while the list is expanded, without reporting it', async () => {
  const { screen } = await renderPanel()
  collectionLoad.current.reject(apiError({ status: 503, message: 'Marketplace unavailable' }))

  await expect.element(screen.getByRole('alert')).toMatchTextContent('loadFailed')
  // The cache reports after the render that follows the failure; let that window pass.
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.getByText('Marketplace unavailable').query()).toBeNull()
})

it('reports a load that fails while the list is collapsed, since nothing shows it', async () => {
  const { screen, toggle } = await renderPanel()
  await toggle.click()
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  collectionLoad.current.reject(apiError({ status: 503, message: 'Marketplace unavailable' }))

  await expect.element(screen.getByText('Marketplace unavailable', { exact: true })).toBeVisible()
  expect(screen.getByRole('alert').query()).toBeNull()
})
