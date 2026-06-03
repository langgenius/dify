import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import { usePathname, useRouter } from '@/next/navigation'
import { AgentDetailSection, AgentDetailTop } from '../navigation'

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    usePathname: vi.fn(),
    useRouter: vi.fn(),
  }
})

function GotoAnythingOpenProbe() {
  const open = useGotoAnythingOpen()

  return <div data-testid="goto-anything-open">{String(open)}</div>
}

const renderWithGotoAnythingStore = (ui: ReactNode) => {
  const store = createStore()

  return render(
    <JotaiProvider store={store}>
      {ui}
    </JotaiProvider>,
  )
}

describe('Agent detail navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRouter as Mock).mockReturnValue({ back: vi.fn() })
  })

  it('renders roster breadcrumb controls', () => {
    renderWithGotoAnythingStore(<AgentDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'common.menus.roster' })).toHaveAttribute('href', '/roster')
    expect(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' })).toBeInTheDocument()
  })

  it('opens goto anything through atom state', () => {
    renderWithGotoAnythingStore(
      <>
        <AgentDetailTop />
        <GotoAnythingOpenProbe />
      </>,
    )

    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('true')
  })

  it('renders agent detail tabs from the route agent id', () => {
    ;(usePathname as Mock).mockReturnValue('/roster/agent-1/logs')

    render(<AgentDetailSection />)

    expect(screen.getByRole('navigation', { name: 'agentV2.agentDetail.navigationLabel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'agentV2.agentDetail.sections.configure' })).toHaveAttribute('href', '/roster/agent-1/configure')
    expect(screen.getByRole('link', { name: 'agentV2.agentDetail.sections.access' })).toHaveAttribute('href', '/roster/agent-1/access')
    expect(screen.getByRole('link', { name: 'agentV2.agentDetail.sections.logs' })).toHaveAttribute('href', '/roster/agent-1/logs')
    expect(screen.queryByRole('link', { name: 'agentV2.agentDetail.sections.annotation' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'agentV2.agentDetail.sections.monitoring' })).toHaveAttribute('href', '/roster/agent-1/monitoring')
  })
})
