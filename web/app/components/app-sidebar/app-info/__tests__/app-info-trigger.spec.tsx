import type { App, AppSSO } from '@/types/app'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import { render as renderWithConsoleState } from '@/test/console/render'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import AppInfoTrigger from '../app-info-trigger'

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

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createAccountProfileQueryWrapper({ id: 'user-1' }),
  })

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('../../../base/app-icon', () => ({
  default: ({
    size,
    icon,
    background,
  }: {
    size: string
    icon: string
    background: string
    iconType?: string
    imageUrl?: string
  }) => (
    <span data-size={size} data-icon={icon} data-bg={background}>
      {icon}
    </span>
  ),
}))

const defaultAppPermissionKeys = [
  AppACLPermission.Edit,
  AppACLPermission.ImportExportDSL,
  AppACLPermission.Delete,
]

const createAppDetail = (overrides: Partial<App> = {}): App & Partial<AppSSO> =>
  ({
    id: 'app-1',
    name: 'Test App',
    mode: AppModeEnum.CHAT,
    icon: '🤖',
    icon_type: 'emoji',
    icon_background: '#FFEAD5',
    icon_url: '',
    description: 'A test app',
    use_icon_as_answer_icon: false,
    permission_keys: defaultAppPermissionKeys,
    maintainer: 'user-1',
    ...overrides,
  }) as App & Partial<AppSSO>

const createProps = (overrides: Partial<React.ComponentProps<typeof AppInfoTrigger>> = {}) => ({
  appDetail: createAppDetail(),
  expand: true,
  openModal: vi.fn(),
  isExporting: false,
  exportCheck: vi.fn(),
  ...overrides,
})

const getOperationsTrigger = () =>
  screen.getByRole('button', { name: /common\.operation\.moreActionsFor/ })

describe('AppInfoTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = ['app.create_and_management']
  })

  it('renders expanded app metadata without making the app info clickable', async () => {
    const user = userEvent.setup()
    const props = createProps({
      appDetail: createAppDetail({ name: 'My Chatbot', mode: AppModeEnum.ADVANCED_CHAT }),
    })
    render(<AppInfoTrigger {...props} />)

    expect(screen.getByText('🤖')).toHaveAttribute('data-size', 'large')
    expect(screen.getByText('My Chatbot')).toBeInTheDocument()
    expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
    expect(screen.getByText('My Chatbot').closest('button')).toBeNull()

    await user.click(screen.getByText('🤖'))

    expect(props.openModal).not.toHaveBeenCalled()
    expect(props.exportCheck).not.toHaveBeenCalled()
  })

  it('renders only the medium app icon when collapsed', () => {
    render(<AppInfoTrigger {...createProps({ expand: false })} />)

    expect(screen.getByText('🤖')).toHaveAttribute('data-size', 'medium')
    expect(screen.queryByText('Test App')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows every available chat app operation and keeps workflow conversion last', async () => {
    const user = userEvent.setup()
    const props = createProps()
    render(<AppInfoTrigger {...props} />)

    await user.click(getOperationsTrigger())

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'app.editApp',
      'app.duplicate',
      'app.export',
      'common.operation.delete',
      'app.switch',
    ])

    await user.click(screen.getByRole('menuitem', { name: 'app.switch' }))
    expect(props.openModal).toHaveBeenCalledWith('switch')
  })

  it('shows import DSL for workflow apps without a workflow conversion operation', async () => {
    const user = userEvent.setup()
    const props = createProps({
      appDetail: createAppDetail({ mode: AppModeEnum.WORKFLOW }),
    })
    render(<AppInfoTrigger {...props} />)

    await user.click(getOperationsTrigger())

    expect(screen.getByRole('menuitem', { name: 'workflow.common.importDSL' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'app.switch' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'workflow.common.importDSL' }))
    expect(props.openModal).toHaveBeenCalledWith('importDSL')
  })

  it('runs export from the menu and disables it while an export is pending', async () => {
    const user = userEvent.setup()
    const props = createProps({ isExporting: true })
    const { rerender } = render(<AppInfoTrigger {...props} />)

    await user.click(getOperationsTrigger())
    expect(screen.getByRole('menuitem', { name: 'app.export' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    const readyProps = createProps()
    rerender(<AppInfoTrigger {...readyProps} />)
    await user.click(screen.getByRole('menuitem', { name: 'app.export' }))

    expect(readyProps.exportCheck).toHaveBeenCalledTimes(1)
  })

  it('hides the operations trigger when no operation is permitted', () => {
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

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
