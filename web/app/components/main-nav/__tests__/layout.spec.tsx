import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MediaType } from '@/hooks/use-breakpoints'
import MainNavLayout from '../layout'

type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType]

let mockMediaType: MediaTypeValue = MediaType.pc
let mockPathname = '/apps'

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mockMediaType,
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: undefined,
  }),
}))

vi.mock('@/context/workspace-context-provider', () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <div data-testid="workspace-provider">{children}</div>,
}))

vi.mock('@/app/components/header', () => ({
  default: () => <div data-testid="desktop-header">Header</div>,
}))

vi.mock('@/app/components/header/header-wrapper', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="header-wrapper">{children}</div>,
}))

vi.mock('../index', () => ({
  default: ({ className }: { className?: string }) => <aside className={className} data-testid="main-nav">MainNav</aside>,
}))

describe('MainNavLayout', () => {
  beforeEach(() => {
    mockMediaType = MediaType.pc
    mockPathname = '/apps'
    localStorage.clear()
  })

  it('renders desktop main nav instead of the desktop header', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('desktop-header')).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('keeps the current header on mobile', () => {
    mockMediaType = MediaType.mobile

    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('header-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('desktop-header')).toBeInTheDocument()
    expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument()
  })

  it('hides the desktop main nav on fullscreen workflow canvases', () => {
    mockPathname = '/apps/app-1/workflow'
    localStorage.setItem('workflow-canvas-maximize', 'true')

    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('main-nav')).toHaveClass('hidden')
  })
})
