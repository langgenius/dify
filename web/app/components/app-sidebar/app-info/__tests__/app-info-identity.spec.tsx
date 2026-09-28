import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AppDetailSection from '../../app-detail-section'

let currentApp = { id: 'app-1', name: 'First app', mode: 'chat' }
const mockConsoleState = vi.hoisted(() => ({
  current: {
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [] as string[],
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ appDetail: currentApp, setAppDetail: vi.fn() }),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/app-1/configuration',
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({ exportAppDsl: vi.fn(), isExporting: false }),
  useExportWorkflowAppDsl: () => ({ exportWorkflowAppDsl: vi.fn(), isExporting: false }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: { onAppMetaUpdate: () => () => {} },
}))

vi.mock('../app-info-trigger', () => ({
  default: ({
    appDetail,
    openModal,
  }: {
    appDetail: { name: string }
    openModal: (modal: 'edit') => void
  }) => <button onClick={() => openModal('edit')}>Open {appDetail.name}</button>,
}))

vi.mock('../app-info-modals', () => ({
  default: ({
    appDetail,
    activeModal,
    secretEnvList,
    setSecretEnvList,
  }: {
    appDetail: { name: string }
    activeModal: string | null
    secretEnvList: unknown[]
    setSecretEnvList: (list: unknown[]) => void
  }) => (
    <div>
      <p>{`${appDetail.name}: ${activeModal ?? 'closed'}; secrets: ${secretEnvList.length}`}</p>
      <button onClick={() => setSecretEnvList([{}])}>Add secret</button>
    </div>
  ),
}))

describe('AppInfoView identity in the app detail sidebar', () => {
  beforeEach(() => {
    currentApp = { id: 'app-1', name: 'First app', mode: 'chat' }
  })

  it('keeps transient state for the same app and clears it when the app changes', async () => {
    const user = userEvent.setup()
    const view = renderWithConsoleQuery(<AppDetailSection />, {
      systemFeatures: { rbac_enabled: false, enable_app_deploy: false },
    })

    await user.click(screen.getByRole('button', { name: 'Open First app' }))
    await user.click(screen.getByRole('button', { name: 'Add secret' }))
    expect(screen.getByText('First app: edit; secrets: 1')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Open First app' }).focus()

    currentApp = { id: 'app-1', name: 'Renamed app', mode: 'chat' }
    view.rerender(<AppDetailSection />)
    expect(screen.getByText('Renamed app: edit; secrets: 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Renamed app' })).toHaveFocus()

    currentApp = { id: 'app-2', name: 'Second app', mode: 'chat' }
    view.rerender(<AppDetailSection />)
    expect(screen.getByRole('button', { name: 'Open Second app' })).toBeInTheDocument()
    expect(screen.getByText('Second app: closed; secrets: 0')).toBeInTheDocument()
  })
})
