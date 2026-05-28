import { render, screen } from '@testing-library/react'
import RosterPage from '../page'

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

describe('RosterPage', () => {
  it('renders the agent roster shell without fetching feature data', () => {
    render(<RosterPage />)

    expect(screen.getByRole('heading', { name: 'common.menus.roster', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'agentV2.roster.title', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'agentV2.roster.sidebarLabel' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('agentV2.roster.searchPlaceholder')).toBeInTheDocument()
    expect(screen.getByText('Iris - Clarification Drafter')).toBeInTheDocument()
    expect(screen.getByText('Aiko - Document Translator')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /agentV2\.roster\.editAgent/ })[0]).toHaveAttribute('href', '/roster/iris/configure')
  })
})
