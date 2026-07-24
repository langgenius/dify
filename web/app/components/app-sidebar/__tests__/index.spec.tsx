import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import AppDetailNav from '..'

let mockAppSidebarExpand = 'expand'
const mockSetAppSidebarExpand = vi.fn()
let mockPathname = '/app/123/overview'

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: { id: 'app-1', name: 'Test', mode: 'chat', icon: '🤖', icon_type: 'emoji', icon_background: '#fff' },
    appSidebarExpand: mockAppSidebarExpand,
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

let mockIsHovering = true
let mockKeyPressCallback: ((e: { preventDefault: () => void }) => void) | null = null

vi.mock('ahooks', () => ({
  useHover: () => mockIsHovering,
  useKeyPress: (_key: string, cb: (e: { preventDefault: () => void }) => void) => {
    mockKeyPressCallback = cb
  },
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: { mobile: 'mobile', desktop: 'desktop' },
}))

let mockSubscriptionCallback: ((v: unknown) => void) | null = null

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: (cb: (v: unknown) => void) => { mockSubscriptionCallback = cb },
    },
  }),
}))

vi.mock('../../base/divider', () => ({
  default: ({ className }: { className?: string }) => <hr data-testid="divider" className={className} />,
}))

vi.mock('@/app/components/workflow/utils', () => ({
  getKeyboardKeyCodeBySystem: () => 'ctrl',
}))

vi.mock('../app-info', () => ({
  default: ({ expand }: { expand: boolean }) => (
    <div data-testid="app-info" data-expand={expand} />
  ),
}))

vi.mock('../app-sidebar-dropdown', () => ({
  default: ({ navigation }: { navigation: unknown[] }) => (
    <div data-testid="app-sidebar-dropdown" data-nav-count={navigation.length} />
  ),
}))

vi.mock('../dataset-info', () => ({
  default: ({ expand }: { expand: boolean }) => (
    <div data-testid="dataset-info" data-expand={expand} />
  ),
}))

vi.mock('../dataset-sidebar-dropdown', () => ({
  default: ({ navigation }: { navigation: unknown[] }) => (
    <div data-testid="dataset-sidebar-dropdown" data-nav-count={navigation.length} />
  ),
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href, mode }: { name: string, href: string, mode?: string }) => (
    <a data-testid={`nav-link-${name}`} href={href} data-mode={mode}>{name}</a>
  ),
}))

vi.mock('../toggle-button', () => ({
  default: ({ expand, handleToggle, className }: { expand: boolean, handleToggle: () => void, className?: string }) => (
    <button type="button" data-testid="toggle-button" data-expand={expand} onClick={handleToggle} className={className}>
      Toggle
    </button>
  ),
}))

const MockIcon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />

const navigation = [
  { name: 'Overview', href: '/overview', icon: MockIcon, selectedIcon: MockIcon },
  { name: 'Logs', href: '/logs', icon: MockIcon, selectedIcon: MockIcon },
]

describe('AppDetailNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppSidebarExpand = 'expand'
    mockPathname = '/app/123/overview'
    mockIsHovering = true
  })

  describe('Normal sidebar mode', () => {
    it('should render AppInfo when iconType is app', () => {
      render(<AppDetailNav navigation={navigation} />)
      expect(screen.getByTestId('app-info')).toBeInTheDocument()
      expect(screen.getByTestId('app-info')).toHaveAttribute('data-expand', 'true')
    })

    it('should render DatasetInfo when iconType is dataset', () => {
      render(<AppDetailNav navigation={navigation} iconType="dataset" />)
      expect(screen.getByTestId('dataset-info')).toBeInTheDocument()
    })

    it('should render navigation links', () => {
      render(<AppDetailNav navigation={navigation} />)
      expect(screen.getByTestId('nav-link-Overview')).toBeInTheDocument()
      expect(screen.getByTestId('nav-link-Logs')).toBeInTheDocument()
    })

    it('should render divider', () => {
      render(<AppDetailNav navigation={navigation} />)
      expect(screen.getByTestId('divider')).toBeInTheDocument()
    })

    it('should apply expanded width class', () => {
      const { container } = render(<AppDetailNav navigation={navigation} />)
      const sidebar = container.firstElementChild as HTMLElement
      expect(sidebar).toHaveClass('w-[216px]')
    })

    it('should apply collapsed width class', () => {
      mockAppSidebarExpand = 'collapse'
      const { container } = render(<AppDetailNav navigation={navigation} />)
      const sidebar = container.firstElementChild as HTMLElement
      expect(sidebar).toHaveClass('w-14')
    })

    it('should render extraInfo when iconType is dataset and extraInfo provided', () => {
      render(
        <AppDetailNav
          navigation={navigation}
          iconType="dataset"
          extraInfo={mode => <div data-testid="extra-info" data-mode={mode} />}
        />,
      )
      expect(screen.getByTestId('extra-info')).toBeInTheDocument()
    })

    it('should not render extraInfo when iconType is app', () => {
      render(
        <AppDetailNav
          navigation={navigation}
          extraInfo={mode => <div data-testid="extra-info" data-mode={mode} />}
        />,
      )
      expect(screen.queryByTestId('extra-info')).not.toBeInTheDocument()
    })
  })

  describe('Workflow canvas mode', () => {
    it('should render AppSidebarDropdown when in workflow canvas with hidden header', () => {
      mockPathname = '/app/123/workflow'
      localStorage.setItem('workflow-canvas-maximize', 'true')

      render(<AppDetailNav navigation={navigation} />)

      expect(screen.getByTestId('app-sidebar-dropdown')).toBeInTheDocument()
      expect(screen.queryByTestId('app-info')).not.toBeInTheDocument()
    })

    it('should render normal sidebar when workflow canvas is not maximized', () => {
      mockPathname = '/app/123/workflow'
      localStorage.setItem('workflow-canvas-maximize', 'false')

      render(<AppDetailNav navigation={navigation} />)

      expect(screen.queryByTestId('app-sidebar-dropdown')).not.toBeInTheDocument()
      expect(screen.getByTestId('app-info')).toBeInTheDocument()
    })
  })

  describe('Pipeline canvas mode', () => {
    it('should render DatasetSidebarDropdown when in pipeline canvas with hidden header', () => {
      mockPathname = '/dataset/123/pipeline'
      localStorage.setItem('workflow-canvas-maximize', 'true')

      render(<AppDetailNav navigation={navigation} />)

      expect(screen.getByTestId('dataset-sidebar-dropdown')).toBeInTheDocument()
      expect(screen.queryByTestId('app-info')).not.toBeInTheDocument()
    })
  })

  describe('Navigation mode', () => {
    it('should pass expand mode to nav links when expanded', () => {
      render(<AppDetailNav navigation={navigation} />)
      expect(screen.getByTestId('nav-link-Overview')).toHaveAttribute('data-mode', 'expand')
    })

    it('should pass collapse mode to nav links when collapsed', () => {
      mockAppSidebarExpand = 'collapse'
      render(<AppDetailNav navigation={navigation} />)
      expect(screen.getByTestId('nav-link-Overview')).toHaveAttribute('data-mode', 'collapse')
    })
  })

  describe('Toggle behavior', () => {
    it('should call setAppSidebarExpand on toggle', async () => {
      const user = userEvent.setup()
      render(<AppDetailNav navigation={navigation} />)

      await user.click(screen.getByTestId('toggle-button'))

      expect(mockSetAppSidebarExpand).toHaveBeenCalledWith('collapse')
    })

    it('should toggle from collapse to expand', async () => {
      const user = userEvent.setup()
      mockAppSidebarExpand = 'collapse'
      render(<AppDetailNav navigation={navigation} />)

      await user.click(screen.getByTestId('toggle-button'))

      expect(mockSetAppSidebarExpand).toHaveBeenCalledWith('expand')
    })
  })

  describe('Sidebar persistence', () => {
    it('should persist expand state to localStorage', () => {
      render(<AppDetailNav navigation={navigation} />)
      expect(localStorage.setItem).toHaveBeenCalledWith('app-detail-collapse-or-expand', 'expand')
    })
  })

  describe('Disabled navigation items', () => {
    it('should render disabled navigation items', () => {
      const navWithDisabled = [
        ...navigation,
        { name: 'Disabled', href: '/disabled', icon: MockIcon, selectedIcon: MockIcon, disabled: true },
      ]
      render(<AppDetailNav navigation={navWithDisabled} />)
      expect(screen.getByTestId('nav-link-Disabled')).toBeInTheDocument()
    })
  })

  describe('Event emitter subscription', () => {
    it('should handle workflow-canvas-maximize event', () => {
      mockPathname = '/app/123/workflow'
      render(<AppDetailNav navigation={navigation} />)

      const cb = mockSubscriptionCallback
      expect(cb).not.toBeNull()
      act(() => {
        cb!({ type: 'workflow-canvas-maximize', payload: true })
      })
    })

    it('should ignore non-maximize events', () => {
      render(<AppDetailNav navigation={navigation} />)

      const cb = mockSubscriptionCallback
      act(() => {
        cb!({ type: 'other-event' })
      })
    })
  })

  describe('Keyboard shortcut', () => {
    it('should toggle sidebar on ctrl+b', () => {
      render(<AppDetailNav navigation={navigation} />)

      const cb = mockKeyPressCallback
      expect(cb).not.toBeNull()
      act(() => {
        cb!({ preventDefault: vi.fn() })
      })
      expect(mockSetAppSidebarExpand).toHaveBeenCalledWith('collapse')
    })
  })

  describe('Hover-based toggle button visibility', () => {
    it('should hide toggle button when not hovering', () => {
      mockIsHovering = false
      render(<AppDetailNav navigation={navigation} />)
      expect(screen.queryByTestId('toggle-button')).not.toBeInTheDocument()
    })
  })
})
