import type { SVGProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppDetailNav from '@/app/components/app-sidebar'

const mockSetAppSidebarExpand = vi.fn()

let mockAppSidebarExpand = 'expand'
let mockPathname = '/app/app-1/logs'
let mockSelectedSegment = 'logs'
let mockIsHovering = true
let keyPressHandler: ((event: { preventDefault: () => void }) => void) | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: {
      id: 'app-1',
      name: 'Demo App',
      mode: 'chat',
      icon: '🤖',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
      icon_url: null,
    },
    appSidebarExpand: mockAppSidebarExpand,
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useSelectedLayoutSegment: () => mockSelectedSegment,
}))

vi.mock('@/next/link', () => ({
  default: ({
    href,
    children,
    className,
    title,
  }: {
    href: string
    children?: React.ReactNode
    className?: string
    title?: string
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}))

vi.mock('ahooks', () => ({
  useHover: () => mockIsHovering,
  useKeyPress: (_key: string, handler: (event: { preventDefault: () => void }) => void) => {
    keyPressHandler = handler
  },
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
    desktop: 'desktop',
  },
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: vi.fn(),
    },
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  getKeyboardKeyCodeBySystem: () => 'ctrl',
  getKeyboardKeyNameBySystem: (key: string) => key,
}))

vi.mock('@/app/components/base/portal-to-follow-elem', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const OpenContext = React.createContext(false)

  return {
    PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
      <OpenContext.Provider value={open}>
        <div>{children}</div>
      </OpenContext.Provider>
    ),
    PortalToFollowElemTrigger: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick?: () => void
    }) => (
      <button type="button" data-testid="portal-trigger" onClick={onClick}>
        {children}
      </button>
    ),
    PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => {
      const open = React.useContext(OpenContext)
      return open ? <div>{children}</div> : null
    },
  }
})

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/app-sidebar/app-info', () => ({
  default: ({
    expand,
    onlyShowDetail,
    openState,
  }: {
    expand: boolean
    onlyShowDetail?: boolean
    openState?: boolean
  }) => (
    <div
      data-testid={onlyShowDetail ? 'app-info-detail' : 'app-info'}
      data-expand={expand}
      data-open={openState}
    />
  ),
}))

const MockIcon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />

const navigation = [
  { name: 'Overview', href: '/app/app-1/overview', icon: MockIcon, selectedIcon: MockIcon },
  { name: 'Logs', href: '/app/app-1/logs', icon: MockIcon, selectedIcon: MockIcon },
]

describe('App Sidebar Shell Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockAppSidebarExpand = 'expand'
    mockPathname = '/app/app-1/logs'
    mockSelectedSegment = 'logs'
    mockIsHovering = true
    keyPressHandler = null
  })

  it('renders the expanded sidebar, marks the active nav item, and toggles collapse by click and shortcut', () => {
    render(<AppDetailNav navigation={navigation} />)

    expect(screen.getByTestId('app-info')).toHaveAttribute('data-expand', 'true')

    const logsLink = screen.getByRole('link', { name: /Logs/i })
    expect(logsLink.className).toContain('bg-components-menu-item-bg-active')

    fireEvent.click(screen.getByRole('button'))
    expect(mockSetAppSidebarExpand).toHaveBeenCalledWith('collapse')

    const preventDefault = vi.fn()
    keyPressHandler?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalled()
    expect(mockSetAppSidebarExpand).toHaveBeenCalledWith('collapse')
  })

  it('switches to the workflow fullscreen dropdown shell and opens its navigation menu', async () => {
    mockPathname = '/app/app-1/workflow'
    mockSelectedSegment = 'workflow'
    localStorage.setItem('workflow-canvas-maximize', 'true')

    render(<AppDetailNav navigation={navigation} />)

    expect(screen.queryByTestId('app-info')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'operation.more' }))

    expect(await screen.findByText('Demo App')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Logs/i })).toBeInTheDocument()
  })
})
