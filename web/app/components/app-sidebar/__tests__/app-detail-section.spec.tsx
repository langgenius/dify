import { render, screen } from '@testing-library/react'
import AppDetailSection from '../app-detail-section'

let mockAppMode = 'chat'
let mockIsCurrentWorkspaceEditor = true

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
  usePathname: () => '/app/app-1/logs',
}))

vi.mock('../app-info', () => ({
  AppInfoView: () => <div data-testid="app-info" />,
}))

vi.mock('../app-info/use-app-info-actions', () => ({
  useAppInfoActions: () => ({}),
}))

vi.mock('../../base/divider', () => ({
  default: ({ className }: { className?: string }) => <hr className={className} />,
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href }: { name: string, href: string }) => (
    <a href={href}>{name}</a>
  ),
}))

describe('AppDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppMode = 'chat'
    mockIsCurrentWorkspaceEditor = true
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
    })

    it('should render dividers before logs and after annotations for chat apps', () => {
      // Arrange
      mockAppMode = 'chat'

      // Act
      render(<AppDetailSection />)

      // Assert
      expect(screen.getAllByRole('separator')).toHaveLength(3)
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
      expect(screen.getAllByRole('separator')).toHaveLength(3)
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
      expect(screen.getAllByRole('separator')).toHaveLength(1)
      expect(screen.queryByRole('link', { name: 'common.appMenus.logs' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'common.appMenus.annotations' })).not.toBeInTheDocument()
    })
  })
})
