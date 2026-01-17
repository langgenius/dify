import type { App, AppIconType } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'
import { AppModeEnum } from '@/types/app'
import LogAnnotation from './index'

const mockRouterPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/app/components/app/annotation', () => ({
  default: ({ appDetail }: { appDetail: App }) => (
    <div data-testid="annotation" data-app-id={appDetail.id} />
  ),
}))

vi.mock('@/app/components/app/log', () => ({
  default: ({ appDetail }: { appDetail: App }) => (
    <div data-testid="log" data-app-id={appDetail.id} />
  ),
}))

vi.mock('@/app/components/app/workflow-log', () => ({
  default: ({ appDetail }: { appDetail: App }) => (
    <div data-testid="workflow-log" data-app-id={appDetail.id} />
  ),
}))

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: 'app-123',
  name: 'Test App',
  description: 'Test app description',
  author_name: 'Test Author',
  icon_type: 'emoji' as AppIconType,
  icon: ':icon:',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: AppModeEnum.CHAT,
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: Date.now(),
  updated_at: Date.now(),
  site: {
    access_token: 'token',
    app_base_url: 'https://example.com',
  } as App['site'],
  api_base_url: 'https://api.example.com',
  tags: [],
  access_mode: 'public_access' as App['access_mode'],
  ...overrides,
})

describe('LogAnnotation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ appDetail: createMockApp() })
  })

  // Rendering behavior
  describe('Rendering', () => {
    it('should render loading state when app detail is missing', () => {
      // Arrange
      useAppStore.setState({ appDetail: undefined })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render log and annotation tabs for non-completion apps', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.CHAT }) })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.getByText('appLog.title')).toBeInTheDocument()
      expect(screen.getByText('appAnnotation.title')).toBeInTheDocument()
    })

    it('should render only log tab for completion apps', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.COMPLETION }) })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.getByText('appLog.title')).toBeInTheDocument()
      expect(screen.queryByText('appAnnotation.title')).not.toBeInTheDocument()
    })

    it('should hide tabs and render workflow log in workflow mode', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.WORKFLOW }) })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.queryByText('appLog.title')).not.toBeInTheDocument()
      expect(screen.getByTestId('workflow-log')).toBeInTheDocument()
    })
  })

  // Prop-driven behavior
  describe('Props', () => {
    it('should render log content when page type is log', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.CHAT }) })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.getByTestId('log')).toBeInTheDocument()
      expect(screen.queryByTestId('annotation')).not.toBeInTheDocument()
    })

    it('should render annotation content when page type is annotation', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.CHAT }) })

      // Act
      render(<LogAnnotation pageType={PageType.annotation} />)

      // Assert
      expect(screen.getByTestId('annotation')).toBeInTheDocument()
      expect(screen.queryByTestId('log')).not.toBeInTheDocument()
    })
  })

  // User interaction behavior
  describe('User Interactions', () => {
    it('should navigate to annotations when switching from log tab', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<LogAnnotation pageType={PageType.log} />)
      await user.click(screen.getByText('appAnnotation.title'))

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith('/app/app-123/annotations')
    })

    it('should navigate to logs when switching from annotation tab', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<LogAnnotation pageType={PageType.annotation} />)
      await user.click(screen.getByText('appLog.title'))

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith('/app/app-123/logs')
    })
  })
})
