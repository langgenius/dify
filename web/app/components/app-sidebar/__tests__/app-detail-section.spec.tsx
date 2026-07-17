import { screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { AppACLPermission } from '@/utils/permission'
import AppDetailSection from '../app-detail-section'

let mockAppMode = 'chat'
let mockPathname = '/app/app-1/logs'
let mockAppPermissionKeys: string[] = []
let mockIsRbacEnabled = true
const mockAppContextState = vi.hoisted(() => ({
  current: {
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [] as string[],
  },
}))

const render = (ui: Parameters<typeof renderWithSystemFeatures>[0]) =>
  renderWithSystemFeatures(ui, {
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      appDetail: {
        id: 'app-1',
        name: 'Test App',
        mode: mockAppMode,
        icon: '🤖',
        icon_type: 'emoji',
        icon_background: '#fff',
        permission_keys: mockAppPermissionKeys,
      },
    }),
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('../app-info', () => ({
  AppInfoView: () => <div />,
}))

vi.mock('../app-info/use-app-info-actions', () => ({
  useAppInfoActions: vi.fn(() => ({})),
}))

vi.mock('../../base/divider', () => ({
  default: ({ className }: { className?: string }) => <hr className={className} />,
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href }: { name: string; href: string }) => <a href={href}>{name}</a>,
}))

describe('AppDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppMode = 'chat'
    mockPathname = '/app/app-1/logs'
    mockAppPermissionKeys = [AppACLPermission.Monitor]
    mockIsRbacEnabled = true
  })

  // Rendering behavior for app detail navigation entries.
  describe('Rendering', () => {
    it('should render only overview for chat apps with app monitor permission', () => {
      // Arrange
      mockAppMode = 'chat'

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.overview' })).toHaveAttribute(
        'href',
        '/app/app-1/overview',
      )
      expect(screen.queryByRole('link', { name: 'common.appMenus.logs' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
    })

    it('should render logs and annotations for chat apps with app log and annotation permission', () => {
      // Arrange
      mockAppMode = 'chat'
      mockAppPermissionKeys = [AppACLPermission.LogAndAnnotation]

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute(
        'href',
        '/app/app-1/logs',
      )
      expect(screen.getByRole('link', { name: 'common.appMenus.annotations' })).toHaveAttribute(
        'href',
        '/app/app-1/annotations',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.overview' }),
      ).not.toBeInTheDocument()
    })

    it('should only render logs navigation for workflow apps', () => {
      // Arrange
      mockAppMode = 'workflow'
      mockAppPermissionKeys = [AppACLPermission.LogAndAnnotation]

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute(
        'href',
        '/app/app-1/logs',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
    })

    it('should only render logs navigation for completion apps', () => {
      // Arrange
      mockAppMode = 'completion'
      mockAppPermissionKeys = [AppACLPermission.LogAndAnnotation]

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute(
        'href',
        '/app/app-1/logs',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
    })

    it('should render the layout navigation for users with view layout permission', () => {
      // Arrange
      mockAppPermissionKeys = [AppACLPermission.ViewLayout]

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.promptEng' })).toHaveAttribute(
        'href',
        '/app/app-1/configuration',
      )
      expect(screen.queryByRole('link', { name: 'common.appMenus.logs' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.overview' }),
      ).not.toBeInTheDocument()
    })

    it('should hide the layout navigation when layout access is missing', () => {
      // Act
      render(<AppDetailSection />)

      // Assert
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.promptEng' }),
      ).not.toBeInTheDocument()
    })

    it('should render resource access navigation when app access config permission is granted', () => {
      // Arrange
      mockAppPermissionKeys = [AppACLPermission.AccessConfig]

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.settings.resourceAccess' })).toHaveAttribute(
        'href',
        '/app/app-1/access-config',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.overview' }),
      ).not.toBeInTheDocument()
    })

    it('should hide resource access navigation when app access config permission is missing', () => {
      // Act
      render(<AppDetailSection />)

      // Assert
      expect(
        screen.queryByRole('link', { name: 'common.settings.resourceAccess' }),
      ).not.toBeInTheDocument()
    })

    it('should hide resource access navigation when RBAC is disabled', () => {
      // Arrange
      mockIsRbacEnabled = false
      mockAppPermissionKeys = [AppACLPermission.AccessConfig]

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(
        screen.queryByRole('link', { name: 'common.settings.resourceAccess' }),
      ).not.toBeInTheDocument()
    })
  })
})
