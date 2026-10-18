import type { Mock } from 'vite-plus/test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import { renderToString } from 'react-dom/server'
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
    ;(usePathname as Mock).mockReturnValue('/apps')
    mockConsoleState.current = {
      isCurrentWorkspaceDatasetOperator: false,
    }
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

  it('keeps an interactive change when a cached layout supplies the earlier initial value', async () => {
    const user = userEvent.setup()
    ;(usePathname as Mock).mockReturnValue('/datasets/dataset-1/documents')

    const { rerender } = render(
      <MainNavLayout initialDetailSidebarMode="expand" detailSidebar={<DetailSidebarModeProbe />}>
        <div>dataset detail</div>
      </MainNavLayout>,
    )

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
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

  it('lets the first keyboard action skip navigation and focus the single main landmark', async () => {
    render(
      <MainNavLayout initialDetailSidebarMode="expand">
        <div>content</div>
      </MainNavLayout>,
    )

    const main = screen.getByRole('main')

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabIndex', '-1')
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('link', { name: /navigation\.skipToMain/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(main).toHaveFocus()
    expect(main).toHaveTextContent('content')
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

  it.each(['/datasets/create', '/datasets/dataset-1/documents/create', '/deployments/create'])(
    'keeps the global main nav on collection and creation route %s',
    (pathname) => {
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
      expect(
        screen.queryByRole('complementary', { name: 'Detail sidebar' }),
      ).not.toBeInTheDocument()
    },
  )

  it.each([
    { pathname: '/agents/agent-1/configure', datasetOperator: true, agentV2Enabled: true },
    { pathname: '/agents/agent-1/configure', datasetOperator: false, agentV2Enabled: false },
    {
      pathname: '/deployments/app-instance-1/overview',
      datasetOperator: false,
      agentV2Enabled: true,
    },
  ])(
    'keeps global navigation on $pathname (dataset operator: $datasetOperator, agents: $agentV2Enabled)',
    ({ pathname, datasetOperator, agentV2Enabled }) => {
      vi.mocked(usePathname).mockReturnValue(pathname)
      vi.mocked(isAgentV2Enabled).mockReturnValue(agentV2Enabled)
      mockConsoleState.current = { isCurrentWorkspaceDatasetOperator: datasetOperator }
      render(
        <MainNavLayout
          initialDetailSidebarMode="expand"
          detailSidebar={<aside aria-label="Detail sidebar" />}
        >
          <div>detail route content</div>
        </MainNavLayout>,
      )
      expect(screen.getByTestId('main-nav')).toBeInTheDocument()
      expect(
        screen.queryByRole('complementary', { name: 'Detail sidebar' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('main')).toHaveTextContent('detail route content')
    },
  )
})
