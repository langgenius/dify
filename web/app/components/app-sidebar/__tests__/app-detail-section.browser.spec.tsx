import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppACLPermission } from '@/utils/permission'
import AppDetailSection from '../app-detail-section'

// boundary: Next.js pathname/router context is not mounted in a focused Browser Mode render.
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/app-1/logs',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useSelectedLayoutSegment: () => 'logs',
}))

async function renderSection({
  mode = 'chat',
  permissions = [],
  rbacEnabled = true,
  deploymentEdition = 'COMMUNITY',
  publishedWorkflow = false,
  cloudPlan = 'professional',
}: {
  mode?: AppDetailWithSite['mode']
  permissions?: string[]
  rbacEnabled?: boolean
  deploymentEdition?: DeploymentEdition
  publishedWorkflow?: boolean
  cloudPlan?: 'sandbox' | 'professional'
} = {}) {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  seedSystemFeatures(queryClient, {
    deployment_edition: deploymentEdition,
    rbac_enabled: rbacEnabled,
    enable_app_deploy: false,
  })
  if (deploymentEdition === 'CLOUD')
    seedFeatures(queryClient, { billing: { subscription: { plan: cloudPlan } } })
  seedWorkspacePermissionsQuery(queryClient)
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({
      id: 'app-1',
      name: 'Test App',
      mode,
      permission_keys: permissions,
      workflow: publishedWorkflow ? { id: 'workflow-1', type: 'workflow' } : null,
    }),
  )
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
        AppACLPermission.Delete,
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

    const actions = screen.getByRole('button', { name: /common\.operation\.moreActionsFor/ })
    await userEvent.click(actions)
    await expect
      .element(screen.getByRole('menuitem', { name: 'common.operation.delete' }))
      .toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(actions).toHaveFocus()

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

  it('links to evaluation for a published workflow with layout view permission', async () => {
    const screen = await renderSection({
      mode: 'workflow',
      permissions: [AppACLPermission.ViewLayout],
      deploymentEdition: 'ENTERPRISE',
      publishedWorkflow: true,
    })

    await expect
      .element(screen.getByRole('link', { name: 'evaluation.title' }))
      .toHaveAttribute('href', '/app/app-1/evaluation')
  })

  it('explains why evaluation is disabled before the workflow is published', async () => {
    const screen = await renderSection({
      mode: 'workflow',
      permissions: [AppACLPermission.ViewLayout],
      deploymentEdition: 'ENTERPRISE',
    })

    const evaluation = screen.getByRole('button', { name: 'evaluation.title' })
    await expect.element(evaluation).toHaveAttribute('aria-disabled', 'true')
    await expect
      .element(screen.getByRole('link', { name: 'evaluation.title' }))
      .not.toBeInTheDocument()
    await userEvent.hover(evaluation)
    await expect.element(screen.getByText('evaluation.unavailableUntilPublished')).toBeVisible()
  })

  it('explains why evaluation is disabled on a Cloud plan without access', async () => {
    const screen = await renderSection({
      mode: 'workflow',
      permissions: [AppACLPermission.ViewLayout],
      deploymentEdition: 'CLOUD',
      publishedWorkflow: true,
      cloudPlan: 'sandbox',
    })

    const evaluation = screen.getByRole('button', { name: 'evaluation.title' })
    await expect.element(evaluation).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(evaluation)
    await expect.element(screen.getByText('common.compliance.sandboxUpgradeTooltip')).toBeVisible()
  })

  it('omits evaluation for non-workflow apps', async () => {
    const screen = await renderSection({
      mode: 'advanced-chat',
      permissions: [AppACLPermission.ViewLayout],
      deploymentEdition: 'ENTERPRISE',
      publishedWorkflow: true,
    })

    await expect.element(screen.getByText('evaluation.title')).not.toBeInTheDocument()
  })

  it('omits evaluation in Community edition', async () => {
    const screen = await renderSection({
      mode: 'workflow',
      permissions: [AppACLPermission.ViewLayout],
      publishedWorkflow: true,
    })

    await expect.element(screen.getByText('evaluation.title')).not.toBeInTheDocument()
  })
})
