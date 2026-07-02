import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { RosterToolbar } from '../roster-toolbar'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

const renderToolbar = ({
  searchParams = '',
}: {
  searchParams?: string
} = {}) => {
  const queryClient = new QueryClient()

  return renderWithNuqs(
    <QueryClientProvider client={queryClient}>
      <RosterToolbar
        draftAgents={2}
        publishedAgents={1}
      />
    </QueryClientProvider>,
    { searchParams },
  )
}

describe('RosterToolbar', () => {
  it('enables roster filters and emits the selected filter', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const publishedFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.published/ })
    const draftsFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.drafts/ })

    expect(publishedFilter).toBeEnabled()
    expect(draftsFilter).toBeEnabled()

    await user.click(publishedFilter)

    expect(onUrlUpdate).toHaveBeenCalledWith(expect.objectContaining({
      queryString: '?filter=published',
    }))
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
    const { onUrlUpdate } = renderToolbar()

    const createdByMeFilter = screen.getByRole('checkbox', { name: 'agentV2.roster.filters.createdByMe' })

    expect(createdByMeFilter).toHaveAttribute('aria-checked', 'false')

    await user.click(createdByMeFilter)

    expect(onUrlUpdate).toHaveBeenCalledWith(expect.objectContaining({
      queryString: '?created_by_me=true',
    }))
  })

  it('renders sort options and emits the selected sort strategy', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const sortSelect = screen.getByRole('combobox', { name: 'agentV2.roster.sort.label' })

    expect(screen.getByText('agentV2.roster.sort.lastModified')).toBeInTheDocument()

    await user.click(sortSelect)
    await user.click(await screen.findByRole('option', { name: 'agentV2.roster.sort.recentlyCreated' }))

    expect(onUrlUpdate).toHaveBeenCalledWith(expect.objectContaining({
      queryString: '?sort_by=recently_created',
    }))
  })
})
