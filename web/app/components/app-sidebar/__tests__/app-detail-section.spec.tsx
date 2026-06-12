import { render, screen } from '@testing-library/react'
import AppDetailSection from '../app-detail-section'
import { useAppInfoActions } from '../app-info/use-app-info-actions'

let mockAppMode = 'chat'
let mockIsCurrentWorkspaceEditor = true
let mockPathname = '/app/app-1/logs'

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: {
      id: 'app-1',
      name: 'Test App',
      mode: mockAppMode,
      icon: '🤖',
      icon_type: 'emoji',
      icon_background: '#fff',
    },
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
  }),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('../app-info', () => ({
  AppInfoView: ({ expand }: { expand: boolean }) => <div data-testid="app-info" data-expand={expand} />,
}))

vi.mock('../app-info/use-app-info-actions', () => ({
  useAppInfoActions: vi.fn(() => ({})),
}))

vi.mock('../../base/divider', () => ({
  default: ({ className }: { className?: string }) => <hr className={className} />,
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href, mode, iconMap }: { name: string, href: string, mode: string, iconMap: { normal: { displayName?: string } } }) => (
    <a href={href} data-mode={mode} data-icon={iconMap.normal.displayName}>{name}</a>
  ),
}))

describe('AppDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppMode = 'chat'
    mockIsCurrentWorkspaceEditor = true
    mockPathname = '/app/app-1/logs'
  })

  // Rendering behavior for app detail navigation entries.
  describe('Rendering', () => {
    it('should split logs and annotations into separate navigation links for chat apps', () => {
      // Arrange
      mockAppMode = 'chat'

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute('href', '/app/app-1/logs')
      expect(screen.getByRole('link', { name: 'common.appMenus.annotations' })).toHaveAttribute('href', '/app/app-1/annotations')
      expect(screen.getByRole('link', { name: 'common.appMenus.annotations' })).toHaveAttribute('data-icon', 'Annotations')
    })

    it('should render dividers before logs and after annotations for chat apps', () => {
      // Arrange
      mockAppMode = 'chat'

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getAllByRole('separator')).toHaveLength(2)
    })

    it('should only render logs navigation for workflow apps', () => {
      // Arrange
      mockAppMode = 'workflow'

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute('href', '/app/app-1/logs')
      expect(screen.queryByRole('link', { name: 'common.appMenus.annotations' })).not.toBeInTheDocument()
    })

    it('should render dividers before and after logs for workflow apps', () => {
      // Arrange
      mockAppMode = 'workflow'

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getAllByRole('separator')).toHaveLength(2)
    })

    it('should only render logs navigation for completion apps', () => {
      // Arrange
      mockAppMode = 'completion'

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute('href', '/app/app-1/logs')
      expect(screen.queryByRole('link', { name: 'common.appMenus.annotations' })).not.toBeInTheDocument()
    })

    it('should not render log group dividers for non-editor users', () => {
      // Arrange
      mockIsCurrentWorkspaceEditor = false

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.queryAllByRole('separator')).toHaveLength(0)
      expect(screen.queryByRole('link', { name: 'common.appMenus.logs' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'common.appMenus.annotations' })).not.toBeInTheDocument()
    })

    it('should pass collapsed mode to app info and navigation links when collapsed', () => {
      // Act
      render(<AppDetailSection expand={false} />)

      // Assert
      expect(screen.getByTestId('app-info')).toHaveAttribute('data-expand', 'false')
      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute('data-mode', 'collapse')
    })

    it('should scope app info state to the app instead of the current path', () => {
      // Arrange
      const { rerender } = render(<AppDetailSection />)

      // Act
      mockPathname = '/app/app-1/overview'
      rerender(<AppDetailSection />)

      // Assert
      expect(useAppInfoActions).toHaveBeenCalledWith({ resetKey: 'app-1' })
      expect(useAppInfoActions).toHaveBeenLastCalledWith({ resetKey: 'app-1' })
    })
  })
})
