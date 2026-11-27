import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { render } from 'vitest-browser-react'
import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { ThemeProvider } from '@/features/theme/provider'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import MainNavLayout from '../layout'

// boundary: Agent navigation is controlled by a deployment flag outside the route layout.
vi.mock('@/features/agent-v2/feature-flag', () => ({ isAgentV2Enabled: () => true }))

// boundary: the widget key is supplied by the deployment environment.
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ZENDESK_WIDGET_KEY: 'zendesk-key',
}))

it.each([
  '/app/app-1/overview',
  '/datasets/dataset-1/documents',
  '/snippets/snippet-1',
  '/agents/agent-1/configure',
])('keeps paid Cloud support available when %s replaces the main navigation', async (pathname) => {
  const queryClient = createTestQueryClient(() => new Promise(() => {}))
  seedAccountProfileQuery(queryClient, { email: 'user@example.com' })
  seedCurrentWorkspaceQuery(queryClient)
  seedSystemFeatures(queryClient, { deployment_edition: 'CLOUD' })
  seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <ThemeProvider defaultPreference="light">
          <HotkeysProvider defaultOptions={{ hotkey: { platform: 'mac' } }}>
            <MainNavLayout
              initialDetailSidebarMode="expand"
              detailSidebar={
                <DetailSidebarFrame
                  renderTop={() => <div>Detail sidebar</div>}
                  renderSection={() => <div>Detail navigation</div>}
                />
              }
            >
              <div>Detail content</div>
            </MainNavLayout>
          </HotkeysProvider>
        </ThemeProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
    { wrapper: createTestNavigation({ url: pathname }).NavigationProvider },
  )

  await expect
    .element(screen.getByRole('button', { name: 'common.userProfile.contactSupport' }))
    .toBeVisible()
  await expect.element(screen.getByText('Detail navigation')).toBeVisible()
  await expect.element(screen.getByRole('main')).toHaveTextContent('Detail content')
  await expect
    .element(screen.getByRole('navigation', { name: 'common.navigation.primary' }))
    .not.toBeInTheDocument()
})
