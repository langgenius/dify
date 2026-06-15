import type { RosterFilterValue } from '../roster-filter'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RosterToolbar } from '../roster-toolbar'

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
        inUseAgents={1}
        keyword=""
        onFilterChange={onFilterChange}
        onKeywordChange={vi.fn()}
      />
    </QueryClientProvider>,
  )

  return { onFilterChange }
}

describe('RosterToolbar', () => {
  it('enables roster filters and emits the selected filter', async () => {
    const user = userEvent.setup()
    const { onFilterChange } = renderToolbar()

    const inUseFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.inUse/ })
    const draftsFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.drafts/ })

    expect(inUseFilter).toBeEnabled()
    expect(draftsFilter).toBeEnabled()

    await user.click(inUseFilter)

    expect(onFilterChange).toHaveBeenCalledWith('in-use')
  })

  it('renders stable filter count badges and omits the all count', () => {
    renderToolbar()

    expect(screen.getByRole('button', { name: /agentV2\.roster\.filters\.all/ })).not.toHaveTextContent('3')

    expect(screen.getByText('1').parentElement).toHaveClass(
      'min-w-4',
      'shrink-0',
      'border-divider-deep',
      'py-0.5',
      'system-2xs-medium-uppercase',
      'tabular-nums',
    )
    expect(screen.getByText('1')).toHaveClass('min-w-px', 'flex-1', 'text-center')
  })
})
