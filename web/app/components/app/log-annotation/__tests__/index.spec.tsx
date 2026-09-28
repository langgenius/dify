import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import LogAnnotation from '../index'

vi.mock('@/app/components/app/annotation', () => ({
  default: ({ appDetail }: { appDetail: AppDetailWithSite }) => (
    <section aria-label="Annotation log">{appDetail.id}</section>
  ),
}))

vi.mock('@/app/components/app/log', () => ({
  default: ({ appDetail }: { appDetail: AppDetailWithSite }) => (
    <section aria-label="App log">{appDetail.id}</section>
  ),
}))

vi.mock('@/app/components/app/workflow-log', () => ({
  default: ({ appDetail }: { appDetail: AppDetailWithSite }) => (
    <section aria-label="Workflow log">{appDetail.id}</section>
  ),
}))

const createMockApp = (overrides: Partial<AppDetailWithSite> = {}): AppDetailWithSite =>
  createAppDetailFixture({
    id: 'app-123',
    name: 'Test App',
    mode: 'chat',
    site: createAppSiteFixture({ access_token: 'token', app_base_url: 'https://example.com' }),
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
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('should render log content without the old page tabs', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.CHAT }) })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.getByRole('region', { name: 'App log' })).toBeInTheDocument()
      expect(screen.queryByText('appLog.title')).not.toBeInTheDocument()
      expect(screen.queryByText('appAnnotation.title')).not.toBeInTheDocument()
    })

    it('should render completion logs without the old page tabs', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.COMPLETION }) })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.getByRole('region', { name: 'App log' })).toBeInTheDocument()
      expect(screen.queryByText('appLog.title')).not.toBeInTheDocument()
      expect(screen.queryByText('appAnnotation.title')).not.toBeInTheDocument()
    })

    it('should hide tabs and render workflow log in workflow mode', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.WORKFLOW }) })

      // Act
      render(<LogAnnotation pageType={PageType.log} />)

      // Assert
      expect(screen.queryByText('appLog.title')).not.toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Workflow log' })).toBeInTheDocument()
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
      expect(screen.getByRole('region', { name: 'App log' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Annotation log' })).not.toBeInTheDocument()
    })

    it('should render annotation content when page type is annotation', () => {
      // Arrange
      useAppStore.setState({ appDetail: createMockApp({ mode: AppModeEnum.CHAT }) })

      // Act
      render(<LogAnnotation pageType={PageType.annotation} />)

      // Assert
      expect(screen.getByRole('region', { name: 'Annotation log' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'App log' })).not.toBeInTheDocument()
    })
  })
})
