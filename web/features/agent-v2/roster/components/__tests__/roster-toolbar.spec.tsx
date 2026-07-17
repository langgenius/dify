import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { RosterToolbar } from '../roster-toolbar'

vi.mock('@/app/components/app/create-from-dsl-modal', () => ({
  default: ({ show, onSuccess }: { show: boolean; onSuccess?: () => void }) =>
    show ? (
      <div role="dialog" aria-label="agentV2.roster.importDSL">
        <button onClick={onSuccess}>Complete agent import</button>
      </div>
    ) : null,
}))

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

  const result = renderWithNuqs(
    <QueryClientProvider client={queryClient}>
      <RosterToolbar draftAgents={2} publishedAgents={1} />
    </QueryClientProvider>,
    { searchParams },
  )

  return { ...result, queryClient }
}

describe('RosterToolbar', () => {
  it('opens the shared create menu for blank Agent creation and DSL import', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderToolbar()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(screen.getByRole('menuitem', { name: 'app.newApp.startFromBlank' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /app\.importDSL/ })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /app\.importDSL/ }))

    expect(
      await screen.findByRole('dialog', { name: 'agentV2.roster.importDSL' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Complete agent import' }))

    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('enables roster filters and emits the selected filter', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const publishedFilter = screen.getByRole('button', {
      name: /agentV2\.roster\.filters\.published/,
    })
    const draftsFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.drafts/ })

    expect(publishedFilter).toBeEnabled()
    expect(draftsFilter).toBeEnabled()

    await user.click(publishedFilter)

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?filter=published',
      }),
    )
  })

  it('renders stable filter count badges and omits the all count', () => {
    renderToolbar()

    const allFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.all/ })
    const publishedFilter = screen.getByRole('button', {
      name: /agentV2\.roster\.filters\.published/,
    })
    const draftsFilter = screen.getByRole('button', { name: /agentV2\.roster\.filters\.drafts/ })

    expect(allFilter).not.toHaveTextContent('3')
    expect(within(publishedFilter).getByText('1')).toBeInTheDocument()
    expect(within(draftsFilter).getByText('2')).toBeInTheDocument()
  })

  it('renders created-by-me filtering and emits checked state', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const createdByMeFilter = screen.getByRole('checkbox', {
      name: 'agentV2.roster.filters.createdByMe',
    })

    expect(createdByMeFilter).toHaveAttribute('aria-checked', 'false')

    await user.click(createdByMeFilter)

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?created_by_me=true',
      }),
    )
  })

  it('renders sort options and emits the selected sort strategy', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const sortSelect = screen.getByRole('combobox', { name: 'agentV2.roster.sort.label' })

    expect(screen.getByText('agentV2.roster.sort.lastModified')).toBeInTheDocument()

    await user.click(sortSelect)
    await user.click(
      await screen.findByRole('option', { name: 'agentV2.roster.sort.recentlyCreated' }),
    )

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?sort_by=recently_created',
      }),
    )
  })
})
