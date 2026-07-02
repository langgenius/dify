import type { RosterFilterValue } from '../roster-filter'
import type { RosterSortBy } from '../roster-sort'
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
  createdByMe = false,
  filter = 'all',
  sortBy = 'last_modified',
  onCreatedByMeChange = vi.fn(),
  onFilterChange = vi.fn(),
  onSortByChange = vi.fn(),
}: {
  createdByMe?: boolean
  filter?: RosterFilterValue
  sortBy?: RosterSortBy
  onCreatedByMeChange?: (value: boolean) => void
  onFilterChange?: (value: RosterFilterValue) => void
  onSortByChange?: (value: RosterSortBy) => void
} = {}) => {
  const queryClient = new QueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <RosterToolbar
        createdByMe={createdByMe}
        draftAgents={2}
        filter={filter}
        keyword=""
        sortBy={sortBy}
        onCreatedByMeChange={onCreatedByMeChange}
        onFilterChange={onFilterChange}
        onKeywordChange={vi.fn()}
        onSortByChange={onSortByChange}
        publishedAgents={1}
      />
    </QueryClientProvider>,
  )

  return { onCreatedByMeChange, onFilterChange, onSortByChange }
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

  it('renders created-by-me filtering and emits checked state', async () => {
    const user = userEvent.setup()
    const { onCreatedByMeChange } = renderToolbar()

    const createdByMeFilter = screen.getByRole('checkbox', { name: 'agentV2.roster.filters.createdByMe' })

    expect(createdByMeFilter).toHaveAttribute('aria-checked', 'false')

    await user.click(createdByMeFilter)

    expect(onCreatedByMeChange).toHaveBeenCalledWith(true)
  })

  it('renders sort options and emits the selected sort strategy', async () => {
    const user = userEvent.setup()
    const { onSortByChange } = renderToolbar()

    const sortSelect = screen.getByRole('combobox', { name: 'agentV2.roster.sort.label' })

    expect(screen.getByText('agentV2.roster.sort.lastModified')).toBeInTheDocument()

    await user.click(sortSelect)
    await user.click(await screen.findByRole('option', { name: 'agentV2.roster.sort.recentlyCreated' }))

    expect(onSortByChange).toHaveBeenCalledWith('recently_created')
  })
})
