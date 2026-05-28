import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
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

describe('Agent detail navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRouter as Mock).mockReturnValue({ back: vi.fn() })
  })

  it('renders roster breadcrumb controls', () => {
    render(<AgentDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'common.menus.roster' })).toHaveAttribute('href', '/roster')
    expect(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' })).toBeInTheDocument()
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
