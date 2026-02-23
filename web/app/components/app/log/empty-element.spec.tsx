import type { App } from '@/types/app'
import { render, screen } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import EmptyElement from './empty-element'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  Trans: ({ i18nKey, components }: { i18nKey: string, components: Record<string, React.ReactNode> }) => (
    <span data-testid="trans-component" data-i18n-key={i18nKey}>
      {i18nKey}
      {components.shareLink}
      {components.testLink}
    </span>
  ),
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirectionPath: (isTest: boolean, _app: App) => isTest ? '/test-path' : '/prod-path',
}))

vi.mock('@/utils/var', () => ({
  basePath: '/base',
}))

describe('EmptyElement', () => {
  const createMockAppDetail = (mode: AppModeEnum) => ({
    id: 'test-app-id',
    name: 'Test App',
    description: 'Test description',
    mode,
    icon_type: 'emoji',
    icon: 'test-icon',
    icon_background: '#ffffff',
    enable_site: true,
    enable_api: true,
    created_at: Date.now(),
    site: {
      access_token: 'test-token',
      app_base_url: 'https://app.example.com',
    },
  }) as unknown as App

  describe('Rendering', () => {
    it('should render empty element with title', () => {
      const appDetail = createMockAppDetail(AppModeEnum.CHAT)
      render(<EmptyElement appDetail={appDetail} />)

      expect(screen.getByText('table.empty.element.title')).toBeInTheDocument()
    })

    it('should render Trans component with i18n key', () => {
      const appDetail = createMockAppDetail(AppModeEnum.CHAT)
      render(<EmptyElement appDetail={appDetail} />)

      const transComponent = screen.getByTestId('trans-component')
      expect(transComponent).toHaveAttribute('data-i18n-key', 'table.empty.element.content')
    })

    it('should render ThreeDotsIcon SVG', () => {
      const appDetail = createMockAppDetail(AppModeEnum.CHAT)
      const { container } = render(<EmptyElement appDetail={appDetail} />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('App Mode Handling', () => {
    it('should use CHAT mode for chat apps', () => {
      const appDetail = createMockAppDetail(AppModeEnum.CHAT)
      render(<EmptyElement appDetail={appDetail} />)

      const link = screen.getAllByRole('link')[0]
      expect(link).toHaveAttribute('href', 'https://app.example.com/base/chat/test-token')
    })

    it('should use COMPLETION mode for completion apps', () => {
      const appDetail = createMockAppDetail(AppModeEnum.COMPLETION)
      render(<EmptyElement appDetail={appDetail} />)

      const link = screen.getAllByRole('link')[0]
      expect(link).toHaveAttribute('href', 'https://app.example.com/base/completion/test-token')
    })

    it('should use WORKFLOW mode for workflow apps', () => {
      const appDetail = createMockAppDetail(AppModeEnum.WORKFLOW)
      render(<EmptyElement appDetail={appDetail} />)

      const link = screen.getAllByRole('link')[0]
      expect(link).toHaveAttribute('href', 'https://app.example.com/base/workflow/test-token')
    })

    it('should use CHAT mode for advanced-chat apps', () => {
      const appDetail = createMockAppDetail(AppModeEnum.ADVANCED_CHAT)
      render(<EmptyElement appDetail={appDetail} />)

      const link = screen.getAllByRole('link')[0]
      expect(link).toHaveAttribute('href', 'https://app.example.com/base/chat/test-token')
    })

    it('should use CHAT mode for agent-chat apps', () => {
      const appDetail = createMockAppDetail(AppModeEnum.AGENT_CHAT)
      render(<EmptyElement appDetail={appDetail} />)

      const link = screen.getAllByRole('link')[0]
      expect(link).toHaveAttribute('href', 'https://app.example.com/base/chat/test-token')
    })
  })

  describe('Links', () => {
    it('should render share link with correct attributes', () => {
      const appDetail = createMockAppDetail(AppModeEnum.CHAT)
      render(<EmptyElement appDetail={appDetail} />)

      const links = screen.getAllByRole('link')
      const shareLink = links[0]

      expect(shareLink).toHaveAttribute('target', '_blank')
      expect(shareLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render test link with redirection path', () => {
      const appDetail = createMockAppDetail(AppModeEnum.CHAT)
      render(<EmptyElement appDetail={appDetail} />)

      const links = screen.getAllByRole('link')
      const testLink = links[1]

      expect(testLink).toHaveAttribute('href', '/test-path')
    })
  })
})
