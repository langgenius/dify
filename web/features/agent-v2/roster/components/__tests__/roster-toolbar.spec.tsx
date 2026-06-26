import type { RosterFilterValue } from '../roster-filter'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RosterToolbar } from '../roster-toolbar'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

const renderToolbar = ({
  filter = 'all',
  onFilterChange = vi.fn(),
}: {
  filter?: RosterFilterValue
  onFilterChange?: (value: RosterFilterValue) => void
} = {}) => {
  const queryClient = new QueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <RosterToolbar
        draftAgents={2}
        filter={filter}
        keyword=""
        onFilterChange={onFilterChange}
        onKeywordChange={vi.fn()}
        publishedAgents={1}
      />
    </QueryClientProvider>,
  )

  return { onFilterChange }
}

describe('RosterToolbar', () => {
  it('enables roster filters and emits the selected filter', async () => {
    const user = userEvent.setup()
    const { onFilterChange } = renderToolbar()

    const publishedFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.published/ })
    const draftsFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.drafts/ })

    expect(publishedFilter).toBeEnabled()
    expect(draftsFilter).toBeEnabled()

    await user.click(publishedFilter)

    expect(onFilterChange).toHaveBeenCalledWith('published')
  })

  it('renders stable filter count badges and omits the all count', () => {
    renderToolbar()

    const allFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.all/ })
    const publishedFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.published/ })
    const draftsFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.drafts/ })

    expect(allFilter).not.toHaveTextContent('3')
    expect(within(publishedFilter).getByText('1')).toBeInTheDocument()
    expect(within(draftsFilter).getByText('2')).toBeInTheDocument()
  })
})
