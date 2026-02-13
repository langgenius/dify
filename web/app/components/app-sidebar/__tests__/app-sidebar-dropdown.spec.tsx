import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { AppModeEnum } from '@/types/app'
import AppSidebarDropdown from '../components/app-sidebar-dropdown'

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => 'overview',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({ isCurrentWorkspaceEditor: true }),
}))

vi.mock('../app-info', () => ({
  default: ({ expand, onlyShowDetail, openState }: Record<string, unknown>) => (
    <div data-testid="app-info" data-expand={expand} data-only={onlyShowDetail} data-open={openState} />
  ),
}))

const MockIcon = ({ className }: { className?: string }) => <svg className={className} />

const navigation = [
  { name: 'Overview', href: '/app/app-1/overview', icon: MockIcon, selectedIcon: MockIcon },
  { name: 'Orchestrate', href: '/app/app-1/workflow', icon: MockIcon, selectedIcon: MockIcon },
]

const mockAppDetail = {
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.ADVANCED_CHAT,
  icon: '🤖',
  icon_type: 'emoji' as const,
  icon_background: '#FFEAD5',
  icon_url: '',
  description: 'A test app',
}

function openDropdown() {
  const trigger = document.querySelector('[class*="cursor-pointer"]')
  if (trigger)
    fireEvent.click(trigger)
}

describe('AppSidebarDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useAppStore.setState({ appDetail: mockAppDetail } as never)
    })
  })

  it('should return null when appDetail is undefined', () => {
    act(() => {
      useAppStore.setState({ appDetail: undefined } as never)
    })
    const { container } = render(<AppSidebarDropdown navigation={navigation} />)
    expect(container.innerHTML).toBe('')
  })

  it('should render trigger element', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(document.querySelector('[class*="cursor-pointer"]')).toBeInTheDocument()
  })

  it('should render AppInfo component', () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('app-info')).toBeInTheDocument()
  })

  it('should show app name after opening dropdown', async () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('Test App')).toBeInTheDocument())
  })

  it('should show navigation items after opening', async () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
      expect(screen.getByText('Orchestrate')).toBeInTheDocument()
    })
  })

  it('should show mode label after opening', async () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('app.types.advanced')).toBeInTheDocument())
  })

  it('should close dropdown when clicking app detail area', async () => {
    render(<AppSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('Test App')).toBeInTheDocument())
    const detailArea = screen.getByText('Test App').closest('[class*="cursor-pointer"]')
    if (detailArea)
      fireEvent.click(detailArea)
  })

  it.each([
    [AppModeEnum.CHAT, 'app.types.chatbot'],
    [AppModeEnum.COMPLETION, 'app.types.completion'],
    [AppModeEnum.WORKFLOW, 'app.types.workflow'],
    [AppModeEnum.AGENT_CHAT, 'app.types.agent'],
  ] as const)('should display correct label for mode %s', async (mode, expected) => {
    act(() => {
      useAppStore.setState({ appDetail: { ...mockAppDetail, mode } } as never)
    })
    render(<AppSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument())
  })
})
