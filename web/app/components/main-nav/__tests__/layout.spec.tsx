import type { ReactNode } from 'react'
import type { Mock } from 'vite-plus/test'
import { useSuspenseQuery } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import { createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import { renderToString } from 'react-dom/server'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  detailSidebarModeAtom,
  setDetailSidebarModeAtom,
} from '@/app/components/detail-sidebar/state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { usePathname } from '@/next/navigation'
import { render } from '@/test/console/render'
import MainNavLayout from '../layout'

function DetailSidebarModeProbe() {
  const mode = useAtomValue(detailSidebarModeAtom)
  const setMode = useSetAtom(setDetailSidebarModeAtom)
  return (
    <aside data-mode={mode}>
      <button type="button" onClick={() => setMode('collapse')}>
        Collapse sidebar
      </button>
    </aside>
  )
}

const mockConsoleState = vi.hoisted(() => ({
  current: {
    isCurrentWorkspaceDatasetOperator: false,
  },
}))

vi.mock('@/app/components/header', () => ({
  default: () => <div data-testid="desktop-header">Header</div>,
}))

vi.mock('@/app/components/header/header-wrapper', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="header-wrapper">{children}</div>
  ),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: vi.fn(),
  }
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    usePathname: vi.fn(),
  }
})

vi.mock('../index', () => ({
  MainNav: ({ className }: { className?: string }) => (
    <aside className={className} data-testid="main-nav">
      MainNav
    </aside>
  ),
}))

describe('MainNavLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAppStore.getState().setAppDetail()
    ;(usePathname as Mock).mockReturnValue('/apps')
    mockConsoleState.current = {
      isCurrentWorkspaceDatasetOperator: false,
    }
    ;(useSuspenseQuery as Mock).mockReturnValue({
      data: {
        enable_app_deploy: true,
      },
    })
    ;(isAgentV2Enabled as Mock).mockReturnValue(true)
  })

  it('uses the request preference in server-rendered sidebar markup', () => {
    ;(usePathname as Mock).mockReturnValue('/datasets/dataset-1/documents')

    const html = renderToString(
      <Provider store={createStore()}>
        <MainNavLayout
          initialDetailSidebarMode="collapse"
          detailSidebar={<DetailSidebarModeProbe />}
        >
          <div>dataset detail</div>
        </MainNavLayout>
      </Provider>,
    )

    expect(html).toContain('data-mode="collapse"')
  })

  it('keeps an interactive change when a cached layout supplies the earlier initial value', () => {
    ;(usePathname as Mock).mockReturnValue('/datasets/dataset-1/documents')

    const { rerender } = render(
      <MainNavLayout initialDetailSidebarMode="expand" detailSidebar={<DetailSidebarModeProbe />}>
        <div>dataset detail</div>
      </MainNavLayout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByText('Collapse sidebar').parentElement).toHaveAttribute(
      'data-mode',
      'collapse',
    )

    rerender(
      <MainNavLayout initialDetailSidebarMode="expand" detailSidebar={<DetailSidebarModeProbe />}>
        <div>dataset detail</div>
      </MainNavLayout>,
    )

    expect(screen.getByText('Collapse sidebar').parentElement).toHaveAttribute(
      'data-mode',
      'collapse',
    )
  })

  it('renders desktop main nav instead of the desktop header', () => {
    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>content</div>
      </MainNavLayout>,
    )

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('desktop-header')).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('uses the main nav without the desktop header wrapper', () => {
    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>content</div>
      </MainNavLayout>,
    )

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('header-wrapper')).not.toBeInTheDocument()
    expect(screen.queryByTestId('desktop-header')).not.toBeInTheDocument()
  })

  it('renders one main landmark as the skip navigation target', () => {
    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>content</div>
      </MainNavLayout>,
    )

    const main = screen.getByRole('main')

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabIndex', '-1')
    expect(main).toHaveClass(
      'outline-hidden',
      'focus:outline-hidden',
      'focus-visible:outline-hidden',
    )
    expect(main).toHaveTextContent('content')
  })

  it('renders skip navigation before the repeated main navigation', () => {
    const { container } = render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>content</div>
      </MainNavLayout>,
    )

    const skipLink = screen.getByRole('link', { name: /(?:^|\.)navigation\.skipToMain(?=$|:)/ })

    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(skipLink).toHaveClass(
      'outline-hidden',
      'focus-visible:ring-2',
      'focus-visible:ring-state-accent-solid',
    )
    expect(
      container.querySelector(
        'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).toBe(skipLink)
  })

  it('moves focus to the main content when skip navigation is activated', () => {
    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>content</div>
      </MainNavLayout>,
    )

    const skipLink = screen.getByRole('link', { name: /(?:^|\.)navigation\.skipToMain(?=$|:)/ })
    const main = screen.getByRole('main')

    fireEvent.click(skipLink)

    expect(main).toHaveFocus()
  })

  it.each(['/datasets/dataset-1/documents', '/datasets/dataset-1/documents/document-1/settings'])(
    'renders the detail sidebar slot outside the single skip navigation target on route %s',
    (pathname) => {
      ;(usePathname as Mock).mockReturnValue(pathname)

      render(
        <MainNavLayout
          initialDetailSidebarMode="expand"
          detailSidebar={<aside aria-label="Detail sidebar">Detail sidebar</aside>}
        >
          <div>dataset detail</div>
        </MainNavLayout>,
      )

      const main = screen.getByRole('main')
      const detailSidebar = screen.getByRole('complementary', { name: 'Detail sidebar' })

      expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument()
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(main).toHaveAttribute('id', 'main-content')
      expect(main).toHaveTextContent('dataset detail')
      expect(main).not.toContainElement(detailSidebar)
    },
  )

  it('ignores a retained legacy detail sidebar on New Knowledge routes', () => {
    ;(usePathname as Mock).mockReturnValue('/datasets/new/knowledge-1/sources')

    render(
      <MainNavLayout
        initialDetailSidebarMode="expand"
        detailSidebar={<aside aria-label="Legacy dataset sidebar">Legacy dataset sidebar</aside>}
      >
        <div>new knowledge detail</div>
      </MainNavLayout>,
    )

    expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('complementary', { name: 'Legacy dataset sidebar' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('new knowledge detail')
  })

  it('hides the global main nav on a skill detail route', () => {
    ;(usePathname as Mock).mockReturnValue('/skills/skill-1')

    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>skill detail</div>
      </MainNavLayout>,
    )

    expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('skill detail')
  })

  it('keeps the global main nav on the skills collection route', () => {
    ;(usePathname as Mock).mockReturnValue('/skills')

    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>skills collection</div>
      </MainNavLayout>,
    )

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
  })

  it.each([
    '/datasets/create',
    '/datasets/new/create',
    '/datasets/dataset-1/documents/create',
    '/deployments/create',
  ])('keeps the global main nav on collection and creation route %s', (pathname) => {
    ;(usePathname as Mock).mockReturnValue(pathname)

    render(
      <MainNavLayout
        initialDetailSidebarMode="expand"
        detailSidebar={<aside aria-label="Detail sidebar">Detail sidebar</aside>}
      >
        <div>content</div>
      </MainNavLayout>,
    )

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Detail sidebar' })).not.toBeInTheDocument()
  })

  it.each([
    {
      label: 'agent detail route for dataset operators',
      pathname: '/agents/agent-1/configure',
      consoleState: {
        isCurrentWorkspaceDatasetOperator: true,
      },
      systemFeatures: {
        enable_app_deploy: true,
      },
    },
    {
      label: 'deployment detail route for non-editor workspaces',
      pathname: '/deployments/app-instance-1/overview',
      consoleState: {
        isCurrentWorkspaceDatasetOperator: false,
      },
      systemFeatures: {
        enable_app_deploy: true,
      },
    },
    {
      label: 'deployment detail route when deployment is disabled',
      pathname: '/deployments/app-instance-1/overview',
      consoleState: {
        isCurrentWorkspaceDatasetOperator: false,
      },
      systemFeatures: {
        enable_app_deploy: false,
      },
    },
  ])('keeps the global main nav on $label', ({ pathname, consoleState, systemFeatures }) => {
    ;(usePathname as Mock).mockReturnValue(pathname)
    mockConsoleState.current = consoleState
    ;(useSuspenseQuery as Mock).mockReturnValue({
      data: systemFeatures,
    })

    render(
      <MainNavLayout
        initialDetailSidebarMode="expand"
        detailSidebar={<aside aria-label="Detail sidebar">Detail sidebar</aside>}
      >
        <div>detail route content</div>
      </MainNavLayout>,
    )

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Detail sidebar' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveTextContent('detail route content')
  })

  it('clears app detail state after leaving app routes', () => {
    useAppStore
      .getState()
      .setAppDetail({ id: 'app-1' } as ReturnType<typeof useAppStore.getState>['appDetail'])
    ;(usePathname as Mock).mockReturnValue('/datasets')

    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>content</div>
      </MainNavLayout>,
    )

    expect(useAppStore.getState().appDetail).toBeUndefined()
  })
})
