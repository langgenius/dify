import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { EnvironmentStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppACLPermission } from '@/utils/permission'
import AccessPoint from '..'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'workflow.nodes.common.memories.builtIn': 'Built-in',
  })
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
  }))
})

// The page owns the tabs and scrollport; card contents are outside this regression.
vi.mock('@/app/components/app/access-point/built-in-access-points', () => ({
  BuiltInAccessPoints: () => null,
}))
vi.mock('@/app/components/app/access-point/deployed-environment-access-points', () => ({
  DeployedEnvironmentAccessPoints: () => null,
}))

async function renderAccessPoint(names = ['test-1']) {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient)
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({
      id: 'app-1',
      mode: 'workflow',
      maintainer: 'user-2',
      permission_keys: [AppACLPermission.AccessPointView],
    }),
  )
  const environments: AppEnvironment[] = names.map((name, index) => ({
    id: `environment-${index}`,
    display_name: name,
    description: '',
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    in_use: true,
  }))
  queryClient.setQueryData(
    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey({
      input: { params: { app_id: 'app-1' } },
    }),
    { data: environments },
  )
  const onUrlUpdate = vi.fn()
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <div style={{ width: 320, height: 480 }}>
          <AccessPoint appId="app-1" />
        </div>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return { screen, onUrlUpdate }
}

function focusRingSpace(tab: Element, scrollport: Element) {
  const tabBounds = tab.getBoundingClientRect()
  const viewportBounds = scrollport.getBoundingClientRect()
  return Math.min(
    tabBounds.top - viewportBounds.top,
    viewportBounds.top + scrollport.clientHeight - tabBounds.bottom,
    tabBounds.left - viewportBounds.left,
    viewportBounds.left + scrollport.clientWidth - tabBounds.right,
  )
}

it.each(['{Enter}', ' '])(
  'keeps focus visible and activates the focused environment only with %s',
  async (activationKey) => {
    const { screen, onUrlUpdate } = await renderAccessPoint()
    const builtIn = screen.getByRole('tab', { name: 'Built-in' })
    const deployed = screen.getByRole('tab', { name: 'test-1' })
    await userEvent.tab()
    await expect.element(builtIn).toHaveFocus()

    const scrollport = screen.getByRole('tablist').element()
    // The primitive owns a 2px outer focus ring; the scrollport must leave room for it.
    expect(focusRingSpace(builtIn.element(), scrollport)).toBeGreaterThanOrEqual(2)
    const selectedBackground = getComputedStyle(builtIn.element()).backgroundColor
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(deployed).toHaveFocus()
    await expect.element(builtIn).toHaveAttribute('aria-selected', 'true')
    await expect.element(deployed).toHaveAttribute('aria-selected', 'false')
    expect(getComputedStyle(builtIn.element()).backgroundColor).toBe(selectedBackground)
    expect(getComputedStyle(deployed.element()).backgroundColor).not.toBe(selectedBackground)
    expect(focusRingSpace(deployed.element(), scrollport)).toBeGreaterThanOrEqual(2)
    expect(onUrlUpdate).not.toHaveBeenCalled()

    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(builtIn).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(deployed).toHaveFocus()
    expect(onUrlUpdate).not.toHaveBeenCalled()

    await userEvent.keyboard(activationKey)
    await expect.element(deployed).toHaveAttribute('aria-selected', 'true')
    expect(getComputedStyle(deployed.element()).backgroundColor).toBe(selectedBackground)
    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ queryString: '?environment=environment-0' }),
    )
    await userEvent.tab()
    await expect.element(screen.getByRole('tabpanel', { name: 'test-1' })).toHaveFocus()
  },
)

it('scrolls the first and last keyboard-focused tabs fully into view without activating them', async () => {
  await page.viewport(320, 640)
  const { screen, onUrlUpdate } = await renderAccessPoint([
    'Staging',
    'Canary',
    'Production with long name',
  ])
  await userEvent.tab()
  await userEvent.keyboard('{End}')
  const lastTab = screen.getByRole('tab', { name: 'Production with long name' })
  await expect.element(lastTab).toHaveFocus()
  const scrollport = screen.getByRole('tablist').element()
  await expect.poll(() => focusRingSpace(lastTab.element(), scrollport)).toBeGreaterThanOrEqual(2)
  await expect.element(lastTab).toHaveAttribute('aria-selected', 'false')
  expect(onUrlUpdate).not.toHaveBeenCalled()

  await userEvent.keyboard('{Home}')
  const firstTab = screen.getByRole('tab', { name: 'Built-in' })
  await expect.element(firstTab).toHaveFocus()
  await expect.poll(() => focusRingSpace(firstTab.element(), scrollport)).toBeGreaterThanOrEqual(2)
  expect(onUrlUpdate).not.toHaveBeenCalled()
})
