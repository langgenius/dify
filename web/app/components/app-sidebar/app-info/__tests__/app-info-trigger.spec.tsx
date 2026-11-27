import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import { createAppInfoDialogHandles } from '../app-info-dialog-handles'
import { AppInfoTrigger } from '../app-info-trigger'

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['app.create_and_management'] as string[],
}))
const mockConsoleState = vi.hoisted(() => ({
  current: {
    userProfile: { id: 'user-1' },
    get workspacePermissionKeys() {
      return mockWorkspacePermissionKeys.value
    },
  },
}))

const mockExport = vi.hoisted(() => ({ exportAppDsl: vi.fn(), isExporting: false }))
vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => mockExport,
}))

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createAccountProfileQueryWrapper({ id: 'user-1' }),
  })

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

const defaultAppPermissionKeys = [
  AppACLPermission.Edit,
  AppACLPermission.ImportExportDSL,
  AppACLPermission.Delete,
]

const createAppDetail = (overrides: Partial<AppDetailWithSite> = {}) =>
  createAppDetailFixture({
    id: 'app-1',
    name: 'Test App',
    mode: 'chat' as const,
    icon: '🤖',
    icon_type: 'emoji',
    icon_background: '#FFEAD5',
    icon_url: '',
    description: 'A test app',
    use_icon_as_answer_icon: false,
    permission_keys: defaultAppPermissionKeys,
    maintainer: 'user-1',
    ...overrides,
  })

const createHandles = () => {
  const handles = createAppInfoDialogHandles()
  for (const handle of Object.values(handles)) {
    vi.spyOn(handle, 'open').mockImplementation(() => {})
    vi.spyOn(handle, 'openWithPayload').mockImplementation(() => {})
  }
  return handles
}

const createProps = (overrides: Partial<React.ComponentProps<typeof AppInfoTrigger>> = {}) => ({
  appDetail: createAppDetail(),
  expand: true,
  handles: createHandles(),
  ...overrides,
})

const getOperationsTrigger = () =>
  screen.getByRole('button', { name: /common\.operation\.moreActionsFor/ })

describe('AppInfoTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExport.isExporting = false
    mockWorkspacePermissionKeys.value = ['app.create_and_management']
  })

  it('renders expanded app metadata without making the app info clickable', async () => {
    const user = userEvent.setup()
    const props = createProps({
      appDetail: createAppDetail({ name: 'My Chatbot', mode: 'advanced-chat' as const }),
    })
    render(<AppInfoTrigger {...props} />)

    expect(screen.getByText('🤖')).toBeInTheDocument()
    expect(screen.getByText('My Chatbot')).toBeInTheDocument()
    expect(screen.getByText('app.types.advanced')).toBeInTheDocument()

    await user.click(screen.getByText('🤖'))

    for (const handle of Object.values(props.handles)) expect(handle.open).not.toHaveBeenCalled()
    expect(mockExport.exportAppDsl).not.toHaveBeenCalled()
  })

  it('opens workflow conversion for a chat app', async () => {
    const user = userEvent.setup()
    const props = createProps()
    render(<AppInfoTrigger {...props} />)

    await user.click(getOperationsTrigger())

    await user.click(screen.getByRole('menuitem', { name: 'app.switch' }))
    expect(props.handles.switchApp.open).toHaveBeenCalledWith(null)
  })

  it('shows import DSL for workflow apps without a workflow conversion operation', async () => {
    const user = userEvent.setup()
    const props = createProps({
      appDetail: createAppDetail({ mode: 'workflow' as const }),
    })
    render(<AppInfoTrigger {...props} />)

    await user.click(getOperationsTrigger())

    expect(screen.getByRole('menuitem', { name: 'app.importApp' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'app.switch' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'app.importApp' }))
    expect(props.handles.importDSL.open).toHaveBeenCalledWith(null)
  })

  it('runs export from the menu and disables it while an export is pending', async () => {
    const user = userEvent.setup()
    mockExport.isExporting = true
    const props = createProps()
    const { rerender } = render(<AppInfoTrigger {...props} />)

    await user.click(getOperationsTrigger())
    expect(screen.getByRole('menuitem', { name: 'app.exportApp' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    mockExport.isExporting = false
    rerender(<AppInfoTrigger {...props} />)
    await user.click(screen.getByRole('menuitem', { name: 'app.exportApp' }))

    expect(mockExport.exportAppDsl).toHaveBeenCalledExactlyOnceWith({
      appId: 'app-1',
      appName: 'Test App',
    })
    expect(props.handles.export.openWithPayload).not.toHaveBeenCalled()
  })

  it('confirms the export of a workflow app in a dialog', async () => {
    const user = userEvent.setup()
    const props = createProps({ appDetail: createAppDetail({ mode: 'workflow' as const }) })
    render(<AppInfoTrigger {...props} />)

    await user.click(getOperationsTrigger())
    await user.click(screen.getByRole('menuitem', { name: 'app.exportApp' }))

    expect(props.handles.export.openWithPayload).toHaveBeenCalledWith(null)
    expect(mockExport.exportAppDsl).not.toHaveBeenCalled()
  })

  it('keeps the operations trigger disabled when no operation is permitted', () => {
    mockWorkspacePermissionKeys.value = []
    render(
      <AppInfoTrigger
        {...createProps({
          appDetail: createAppDetail({
            maintainer: 'user-2',
            permission_keys: [AppACLPermission.ViewLayout],
          }),
        })}
      />,
    )

    expect(getOperationsTrigger()).toBeDisabled()
  })
})
