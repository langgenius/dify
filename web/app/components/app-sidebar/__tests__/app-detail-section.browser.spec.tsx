import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppACLPermission } from '@/utils/permission'
import AppDetailSection from '../app-detail-section'

const permissionState = vi.hoisted(() => ({ keys: [] as string[] }))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: permissionState.keys }))
})

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/app-1/logs',
  useSelectedLayoutSegment: () => 'logs',
}))

// AppInfo owns its menu and dialogs; this suite protects the surrounding navigation policy.
vi.mock('../app-info', () => ({ AppInfoView: () => null }))

async function renderSection({
  mode = 'chat',
  permissions = [],
  rbacEnabled = true,
}: {
  mode?: AppDetailWithSite['mode']
  permissions?: string[]
  rbacEnabled?: boolean
} = {}) {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  seedSystemFeatures(queryClient, {
    rbac_enabled: rbacEnabled,
    enable_app_deploy: false,
  })
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({
      id: 'app-1',
      name: 'Test App',
      mode,
      permission_keys: permissions,
    }),
  )
  permissionState.keys = []
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <AppDetailSection />
    </QueryClientTestProvider>,
  )
}

describe('AppDetailSection', () => {
  it('exposes every permitted chat destination in keyboard order', async () => {
    const screen = await renderSection({
      permissions: [
        AppACLPermission.ViewLayout,
        AppACLPermission.AccessPointView,
        AppACLPermission.LogAndAnnotation,
        AppACLPermission.Monitor,
        AppACLPermission.AccessConfig,
      ],
    })
    const destinations = [
      ['common.appMenus.promptEng', '/app/app-1/configuration'],
      ['common.appMenus.accessPoint', '/app/app-1/access-point'],
      ['common.appMenus.logs', '/app/app-1/logs'],
      ['common.appMenus.annotations', '/app/app-1/annotations'],
      ['common.appMenus.overview', '/app/app-1/overview'],
      ['navigation.settings.resourceAccess', '/app/app-1/access-config'],
    ] as const

    for (const [name, href] of destinations)
      await expect.element(screen.getByRole('link', { name })).toHaveAttribute('href', href)

    for (const [name] of destinations) {
      await userEvent.tab()
      await expect.element(screen.getByRole('link', { name })).toHaveFocus()
    }
  })

  it('uses workflow routes while omitting unsupported annotations', async () => {
    const screen = await renderSection({
      mode: 'workflow',
      permissions: [
        AppACLPermission.ViewLayout,
        AppACLPermission.Deploy,
        AppACLPermission.LogAndAnnotation,
      ],
    })

    await expect
      .element(screen.getByRole('link', { name: 'common.appMenus.promptEng' }))
      .toHaveAttribute('href', '/app/app-1/workflow')
    await expect
      .element(screen.getByRole('link', { name: 'common.appMenus.deploy' }))
      .toHaveAttribute('href', '/app/app-1/deploy')
    await expect
      .element(screen.getByRole('link', { name: 'common.appMenus.logs' }))
      .toHaveAttribute('href', '/app/app-1/logs')
    await expect
      .element(screen.getByRole('link', { name: 'common.appMenus.annotations' }))
      .not.toBeInTheDocument()
  })

  it('does not grant destinations from an unrelated permission or app mode', async () => {
    const screen = await renderSection({
      mode: 'agent',
      permissions: [AppACLPermission.Deploy, AppACLPermission.AccessConfig],
    })

    await expect
      .element(screen.getByRole('link', { name: 'common.appMenus.deploy' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'navigation.settings.resourceAccess' }))
      .not.toBeInTheDocument()
  })

  it('hides resource access when RBAC is disabled', async () => {
    const screen = await renderSection({
      permissions: [AppACLPermission.AccessConfig],
      rbacEnabled: false,
    })

    await expect
      .element(screen.getByRole('link', { name: 'navigation.settings.resourceAccess' }))
      .not.toBeInTheDocument()
  })
})
