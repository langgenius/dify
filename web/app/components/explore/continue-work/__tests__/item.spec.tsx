import type { AnchorHTMLAttributes, ReactNode } from 'react'
import type { App } from '@/types/app'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import ContinueWorkItem from '../item'

const mockAppContextState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: ['app.create_and_management'],
}))

const mockFormatTimeFromNow = vi.hoisted(() => vi.fn(() => '5 minutes ago'))

const toastMocks = vi.hoisted(() => ({
  warning: vi.fn(),
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
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
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode, href: string }) => (
    <a href={href} className={className} {...props}>{children}</a>
  ),
}))

const createApp = (overrides: Partial<App> = {}): App => ({
  id: 'app-1',
  name: 'Continue App',
  description: 'Continue app description',
  author_name: 'Alice',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: AppModeEnum.CHAT,
  enable_site: false,
  enable_api: false,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: 100,
  maintainer: 'maintainer-1',
  updated_at: 200,
  site: {} as App['site'],
  api_base_url: '',
  tags: [],
  access_mode: AccessMode.PUBLIC,
  permission_keys: [AppACLPermission.Edit],
  ...overrides,
})

const renderItem = (
  app: App,
  systemFeatures: NonNullable<Parameters<typeof renderWithSystemFeatures>[1]>['systemFeatures'] = { rbac_enabled: true },
) => renderWithSystemFeatures(<ContinueWorkItem app={app} />, { systemFeatures })

describe('ContinueWorkItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContextState.userProfile = { id: 'user-1' }
    mockAppContextState.workspacePermissionKeys = ['app.create_and_management']
    mockFormatTimeFromNow.mockReturnValue('5 minutes ago')
  })

  it('should render a link to the app configuration page when the app is editable', () => {
    renderItem(createApp())

    const link = screen.getByRole('link', { name: /Continue App/ })

    expect(link).toHaveAttribute('href', '/app/app-1/configuration')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('explore.continueWork.editedAt:{"time":"5 minutes ago"}')).toBeInTheDocument()
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(200000)
  })

  it('should use created time when updated time is missing', () => {
    renderItem(createApp({ updated_at: 0, created_at: 123 }))

    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(123000)
  })

  it('should link to access config when RBAC is enabled and only access config permission is available', () => {
    renderItem(createApp({ permission_keys: [AppACLPermission.AccessConfig] }))

    expect(screen.getByRole('link', { name: /Continue App/ })).toHaveAttribute('href', '/app/app-1/access-config')
  })

  it('should fall back to develop when RBAC is disabled for an access-config-only app', () => {
    renderItem(createApp({ permission_keys: [AppACLPermission.AccessConfig] }), { rbac_enabled: false })

    expect(screen.getByRole('link', { name: /Continue App/ })).toHaveAttribute('href', '/app/app-1/develop')
  })

  it('should render preview-only apps as disabled buttons and warn on click', () => {
    renderItem(createApp({ permission_keys: [AppACLPermission.Preview] }))

    const card = screen.getByRole('button', { name: 'Continue App' })

    expect(card).toHaveAttribute('aria-disabled', 'true')
    expect(card).toHaveClass('cursor-not-allowed')
    expect(card).toHaveClass('opacity-60')
    expect(screen.queryByRole('link', { name: /Continue App/ })).not.toBeInTheDocument()

    fireEvent.click(card)

    expect(toastMocks.warning).toHaveBeenCalledWith('app.noAccessResourcePermission')
  })

  it('should warn when activating a preview-only app with Enter or Space', () => {
    renderItem(createApp({ permission_keys: [AppACLPermission.Preview] }))

    const card = screen.getByRole('button', { name: 'Continue App' })

    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.keyDown(card, { key: ' ' })

    expect(toastMocks.warning).toHaveBeenCalledTimes(2)
    expect(toastMocks.warning).toHaveBeenNthCalledWith(1, 'app.noAccessResourcePermission')
    expect(toastMocks.warning).toHaveBeenNthCalledWith(2, 'app.noAccessResourcePermission')
  })

  it('should ignore other keys on preview-only app cards', () => {
    renderItem(createApp({ permission_keys: [AppACLPermission.Preview] }))

    fireEvent.keyDown(screen.getByRole('button', { name: 'Continue App' }), { key: 'Escape' })

    expect(toastMocks.warning).not.toHaveBeenCalled()
  })
})
