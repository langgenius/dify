import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddKnowledgeSpace from '../add-knowledge-space'

const mockUseInfiniteQuery = vi.hoisted(() => vi.fn())
const mockInfiniteOptions = vi.hoisted(() => vi.fn((options: unknown) => options))

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: mockUseInfiniteQuery,
}))

vi.mock('ahooks', () => ({
  useInfiniteScroll: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        get: { infiniteOptions: mockInfiniteOptions },
      },
    },
  },
}))

const BINDING_PERMISSIONS = [
  'knowledge_space_read',
  'knowledge_space_query',
  'knowledge_space_access_config',
]

const space = (
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  control_space_id: id,
  permission_keys: BINDING_PERMISSIONS,
  state: 'active',
  technical_status: 'available',
  technical_summary: { name },
  ...overrides,
})

const mockQuery = (overrides: Record<string, unknown> = {}) => {
  const query = {
    data: {
      pages: [
        {
          data: [
            space('space-1', 'Product docs', {
              technical_summary: { icon: '📘', name: 'Product docs' },
            }),
            space('space-2', 'Archived docs', { technical_status: 'unavailable' }),
          ],
          has_more: false,
          page: 1,
        },
      ],
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isError: false,
    isFetchNextPageError: false,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
    isSuccess: true,
    refetch: vi.fn(),
    ...overrides,
  }
  mockUseInfiniteQuery.mockReturnValue(query)
  return query
}

const openSelector = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole('button', {
      name: 'common.operation.add workflow.nodes.knowledgeRetrievalV2.knowledgeSpaces',
    }),
  )
  return screen.getByRole('dialog')
}

describe('AddKnowledgeSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery()
  })

  it('uses a confirmable multi-select dialog and keeps unavailable existing selections removable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AddKnowledgeSpace
        selectedSpaces={[{ control_space_id: 'space-2', name: 'Archived docs' }]}
        onChange={onChange}
      />,
    )

    const dialog = await openSelector(user)
    const archived = within(dialog).getByRole('checkbox', { name: 'Archived docs' })
    expect(archived).toHaveAttribute('aria-checked', 'true')
    expect(archived).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(archived)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Product docs' }))
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.add' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ control_space_id: 'space-1', icon: '📘', name: 'Product docs' }),
    ])
  })

  it('exposes each row selected state semantically', async () => {
    const user = userEvent.setup()
    render(<AddKnowledgeSpace selectedSpaces={[]} onChange={vi.fn()} />)

    const dialog = await openSelector(user)
    const product = within(dialog).getByRole('checkbox', { name: 'Product docs' })
    expect(product).toHaveAttribute('aria-checked', 'false')
    await user.click(product)
    expect(product).toHaveAttribute('aria-checked', 'true')
  })

  it.each([
    ['without access configuration', { permission_keys: BINDING_PERMISSIONS.slice(0, 2) }],
    ['when inactive', { state: 'deleting' }],
  ])('does not offer a space %s that publishing would reject', async (_, overrides) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    mockQuery({
      data: {
        pages: [
          {
            data: [space('space-3', 'Read-only docs', overrides)],
            has_more: false,
            page: 1,
          },
        ],
      },
    })
    render(<AddKnowledgeSpace selectedSpaces={[]} onChange={onChange} />)

    const dialog = await openSelector(user)
    const restricted = within(dialog).getByRole('checkbox', { name: 'Read-only docs' })
    expect(restricted).toHaveAttribute('aria-disabled', 'true')
    expect(restricted).toHaveAccessibleDescription(
      'workflow.nodes.knowledgeRetrievalV2.unavailable',
    )
    await user.click(restricted)
    expect(restricted).toHaveAttribute('aria-checked', 'false')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.add' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('shows a retryable error instead of an empty catalog when the initial query fails', async () => {
    const user = userEvent.setup()
    const query = mockQuery({ data: undefined, isError: true, isSuccess: false })
    render(<AddKnowledgeSpace selectedSpaces={[]} onChange={vi.fn()} />)

    const dialog = await openSelector(user)
    expect(
      within(dialog).queryByText('workflow.nodes.knowledgeRetrievalV2.noSpaces'),
    ).not.toBeInTheDocument()
    const alert = within(dialog).getByRole('alert')
    expect(alert).toHaveTextContent('workflow.nodes.knowledgeRetrievalV2.loadSpacesError')
    await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))
    expect(query.refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps loaded spaces and offers a retry when the next page fails', async () => {
    const user = userEvent.setup()
    const query = mockQuery({ hasNextPage: true, isError: true, isFetchNextPageError: true })
    render(<AddKnowledgeSpace selectedSpaces={[]} onChange={vi.fn()} />)

    const dialog = await openSelector(user)
    expect(within(dialog).getByRole('checkbox', { name: 'Product docs' })).toBeInTheDocument()
    const alert = within(dialog).getByRole('alert')
    await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))
    expect(query.fetchNextPage).toHaveBeenCalledTimes(1)
    expect(query.refetch).not.toHaveBeenCalled()
  })
})
