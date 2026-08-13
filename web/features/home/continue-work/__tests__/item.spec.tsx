import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppACLPermission } from '@/utils/permission'
import { ContinueWorkItem } from '../item'

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: ['app.create_and_management'],
}))

const mockFormatTimeFromNow = vi.hoisted(() => vi.fn(() => '5 minutes ago'))

const toastMocks = vi.hoisted(() => ({
  warning: vi.fn(),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: mockFormatTimeFromNow,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    warning: toastMocks.warning,
  },
}))

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    className,
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode
    href: string
    prefetch?: boolean | null
  }) => (
    <a
      href={href}
      className={className}
      data-prefetch={prefetch === null ? 'auto' : prefetch}
      {...props}
    >
      {children}
    </a>
  ),
}))

const createApp = (overrides: Partial<RecentAppResponse> = {}): RecentAppResponse => ({
  id: 'app-1',
  name: 'Continue App',
  author_name: 'Alice',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFEAD5',
  icon_url: null,
  mode: 'chat',
  maintainer: 'maintainer-1',
  updated_at: 200,
  permission_keys: [AppACLPermission.Edit],
  ...overrides,
})

const renderItem = (
  app: RecentAppResponse,
  systemFeatures: NonNullable<Parameters<typeof renderWithConsoleQuery>[1]>['systemFeatures'] = {
    rbac_enabled: true,
  },
) =>
  renderWithConsoleQuery(<ContinueWorkItem app={app} />, {
    accountProfile: mockConsoleState.userProfile,
    systemFeatures,
  })

describe('ContinueWorkItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = ['app.create_and_management']
    mockFormatTimeFromNow.mockReturnValue('5 minutes ago')
  })

  it('should render a link to the app configuration page when the app is editable', () => {
    renderItem(createApp())

    const link = screen.getByRole('link', { name: /Continue App/ })

    expect(link).toHaveAttribute('href', '/app/app-1/configuration')
    expect(link).toHaveAccessibleDescription(/Alice.*5 minutes ago/)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(
      screen.getByText('explore.continueWork.editedAt:{"time":"5 minutes ago"}'),
    ).toBeInTheDocument()
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(200000)
  })

  it('should enable prefetch after pointer intent', async () => {
    const user = userEvent.setup()
    renderItem(createApp())

    const link = screen.getByRole('link', { name: /Continue App/ })

    expect(link).toHaveAttribute('data-prefetch', 'false')

    await user.hover(link)

    expect(link).toHaveAttribute('data-prefetch', 'auto')
  })

  it('should enable prefetch after keyboard focus', async () => {
    const user = userEvent.setup()
    renderItem(createApp())

    const link = screen.getByRole('link', { name: /Continue App/ })

    expect(link).toHaveAttribute('data-prefetch', 'false')

    await user.tab()

    expect(link).toHaveFocus()
    expect(link).toHaveAttribute('data-prefetch', 'auto')
  })

  it.each([
    ['chat', 'app.types.chatbot'],
    ['advanced-chat', 'app.types.advanced'],
    ['agent-chat', 'app.types.agent'],
    ['workflow', 'app.types.workflow'],
    ['completion', 'app.types.completion'],
  ] as const)('should include the %s app mode in the accessible name', (mode, label) => {
    renderItem(createApp({ mode }))

    expect(screen.getByRole('link', { name: /Continue App/ })).toHaveAccessibleName(
      new RegExp(label.replaceAll('.', '\\.'), 'i'),
    )
  })

  it('should omit the author separator when the author is unavailable', () => {
    renderItem(createApp({ author_name: null }))

    expect(screen.queryByText('·')).not.toBeInTheDocument()
    expect(
      screen.getByText('explore.continueWork.editedAt:{"time":"5 minutes ago"}'),
    ).toBeInTheDocument()
  })

  it('should link to access config when RBAC is enabled and only access config permission is available', () => {
    renderItem(createApp({ permission_keys: [AppACLPermission.AccessConfig] }))

    expect(screen.getByRole('link', { name: /Continue App/ })).toHaveAttribute(
      'href',
      '/app/app-1/access-config',
    )
  })

  it('should fall back to access point when RBAC is disabled for an access-config-only app', () => {
    renderItem(createApp({ permission_keys: [AppACLPermission.AccessConfig] }), {
      rbac_enabled: false,
    })

    expect(screen.getByRole('link', { name: /Continue App/ })).toHaveAttribute(
      'href',
      '/app/app-1/access-point',
    )
  })

  it('should render preview-only apps as action buttons that explain the access restriction', async () => {
    const user = userEvent.setup()
    renderItem(createApp({ permission_keys: [AppACLPermission.Preview] }))

    const card = screen.getByRole('button', { name: /Continue App.*app\.types\.chatbot/i })

    expect(card).toHaveAttribute('type', 'button')
    expect(card).not.toHaveAttribute('aria-disabled')
    expect(card).toHaveAccessibleDescription(/Alice.*5 minutes ago/)
    expect(screen.queryByRole('link', { name: /Continue App/ })).not.toBeInTheDocument()

    await user.click(card)

    expect(toastMocks.warning).toHaveBeenCalledWith('app.noAccessResourcePermission')
  })

  it('should warn when activating a preview-only app with Enter or Space', async () => {
    const user = userEvent.setup()
    renderItem(createApp({ permission_keys: [AppACLPermission.Preview] }))

    const card = screen.getByRole('button', { name: /Continue App.*app\.types\.chatbot/i })

    card.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(toastMocks.warning).toHaveBeenCalledTimes(2)
    expect(toastMocks.warning).toHaveBeenNthCalledWith(1, 'app.noAccessResourcePermission')
    expect(toastMocks.warning).toHaveBeenNthCalledWith(2, 'app.noAccessResourcePermission')
  })
})
