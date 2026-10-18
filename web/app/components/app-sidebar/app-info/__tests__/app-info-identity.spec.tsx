import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import AppDetailSection from '../../app-detail-section'

let pathname = '/app/app-1/configuration'
let currentApp = createAppDetailFixture({ name: 'First app' })
const mockConsoleState = vi.hoisted(() => ({
  current: {
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [] as string[],
  },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/next/navigation', () => ({
  usePathname: () => pathname,
  useSelectedLayoutSegment: () => pathname.split('/').at(-1),
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({ exportAppDsl: vi.fn(), isExporting: false }),
  useExportWorkflowAppDsl: () => ({ exportWorkflowAppDsl: vi.fn(), isExporting: false }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: { onAppMetaUpdate: () => () => {} },
}))

describe('AppInfoView identity in the app detail sidebar', () => {
  beforeEach(() => {
    pathname = '/app/app-1/configuration'
    currentApp = createAppDetailFixture({
      name: 'First app',
      permission_keys: ['app.acl.edit', 'app.acl.view_layout'],
    })
  })

  it('keeps transient state for the same app and clears it when the app changes', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const seed = () =>
      queryClient.setQueryData(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: currentApp.id } } }),
        currentApp,
      )
    seed()
    const view = renderWithConsoleQuery(<AppDetailSection />, {
      queryClient,
      systemFeatures: { rbac_enabled: false, enable_app_deploy: false },
    })

    await user.click(screen.getByRole('button', { name: /moreActionsFor/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'app.editApp' }))
    const name = await screen.findByRole('textbox', { name: 'app.newApp.captionName' })
    await user.clear(name)
    await user.type(name, 'Unsaved draft')

    currentApp = { ...currentApp, name: 'Renamed app' }
    await act(async () => {
      seed()
    })
    view.rerender(<AppDetailSection />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(name).toHaveValue('Unsaved draft')
    expect(name).toHaveFocus()

    currentApp = createAppDetailFixture({ id: 'app-2', name: 'Second app' })
    pathname = '/app/app-2/configuration'
    seed()
    view.rerender(<AppDetailSection />)
    expect(screen.getByText('Second app')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
