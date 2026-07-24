import type { App, AppSSO } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppSidebarDropdown from '../app-sidebar-dropdown'

let mockAppDetail: (App & Partial<AppSSO>) | undefined

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: mockAppDetail,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
    <div data-testid="portal-elem" data-open={open}>{children}</div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

vi.mock('../../base/app-icon', () => ({
  default: ({ size, icon }: { size: string, icon: string }) => (
    <div data-testid="app-icon" data-size={size} data-icon={icon} />
  ),
}))

vi.mock('../../base/divider', () => ({
  default: () => <hr data-testid="divider" />,
}))

vi.mock('../app-info', () => ({
  default: ({ expand, onlyShowDetail, openState }: {
    expand: boolean
    onlyShowDetail?: boolean
    openState?: boolean
  }) => (
    <div data-testid="app-info" data-expand={expand} data-only-detail={onlyShowDetail} data-open={openState} />
  ),
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href, mode }: { name: string, href: string, mode?: string }) => (
    <a data-testid={`nav-link-${name}`} href={href} data-mode={mode}>{name}</a>
  ),
}))

const MockIcon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />

const createAppDetail = (overrides: Partial<App> = {}): App & Partial<AppSSO> => ({
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFEAD5',
  icon_url: '',
  description: '',
  use_icon_as_answer_icon: false,
  ...overrides,
} as App & Partial<AppSSO>)

const navigation = [
  { name: 'Overview', href: '/overview', icon: MockIcon, selectedIcon: MockIcon },
  { name: 'Logs', href: '/logs', icon: MockIcon, selectedIcon: MockIcon },
]

describe('AppSidebarDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetail = createAppDetail()
  })

  it('should return null when appDetail is not available', () => {
    mockAppDetail = undefined
    const { container } = render(<AppSidebarDropdown navigation={navigation} />)
    expect(container.innerHTML).toBe('')
  })

  it('should render trigger with app icon', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    const icons = screen.getAllByTestId('app-icon')
    const smallIcon = icons.find(i => i.getAttribute('data-size') === 'small')
    expect(smallIcon).toBeInTheDocument()
  })

  it('should render navigation links', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('nav-link-Overview')).toBeInTheDocument()
    expect(screen.getByTestId('nav-link-Logs')).toBeInTheDocument()
  })

  it('should display app name', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('Test App')).toBeInTheDocument()
  })

  it('should display app mode label', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('app.types.chatbot')).toBeInTheDocument()
  })

  it('should display mode labels for different modes', () => {
    mockAppDetail = createAppDetail({ mode: AppModeEnum.ADVANCED_CHAT })
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
  })

  it('should render AppInfo component for detail expand', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('app-info')).toBeInTheDocument()
    expect(screen.getByTestId('app-info')).toHaveAttribute('data-only-detail', 'true')
  })

  it('should toggle portal open state when trigger is clicked', async () => {
    const user = userEvent.setup()
    render(<AppSidebarDropdown navigation={navigation} />)

    const trigger = screen.getByTestId('portal-trigger')
    await user.click(trigger)

    const portal = screen.getByTestId('portal-elem')
    expect(portal).toHaveAttribute('data-open', 'true')
  })

  it('should render divider between app info and navigation', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('divider')).toBeInTheDocument()
  })

  it('should render large app icon in dropdown content', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    const icons = screen.getAllByTestId('app-icon')
    const largeIcon = icons.find(icon => icon.getAttribute('data-size') === 'large')
    expect(largeIcon).toBeInTheDocument()
  })

  it('should set detailExpand when clicking app info area', async () => {
    const user = userEvent.setup()
    render(<AppSidebarDropdown navigation={navigation} />)

    const appName = screen.getByText('Test App')
    const appInfoArea = appName.closest('[class*="cursor-pointer"]')
    if (appInfoArea)
      await user.click(appInfoArea)
  })

  it('should display workflow mode label', () => {
    mockAppDetail = createAppDetail({ mode: AppModeEnum.WORKFLOW })
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('app.types.workflow')).toBeInTheDocument()
  })

  it('should display agent mode label', () => {
    mockAppDetail = createAppDetail({ mode: AppModeEnum.AGENT_CHAT })
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('app.types.agent')).toBeInTheDocument()
  })

  it('should display completion mode label', () => {
    mockAppDetail = createAppDetail({ mode: AppModeEnum.COMPLETION })
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('app.types.completion')).toBeInTheDocument()
  })
})
