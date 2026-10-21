import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AddKnowledgeSpace from '../add-knowledge-space'

const listSpaces = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.get': listSpaces,
    }),
  }
})

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
  created_at: '2026-08-18T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account-1',
  permission_keys: BINDING_PERMISSIONS,
  resource_version: 1,
  state: 'active',
  technical_status: 'available',
  technical_summary: { knowledge_space_id: id, name, revision: 1, slug: id },
  updated_at: '2026-08-18T00:00:00Z',
  visibility: 'only_me',
  ...overrides,
})

const page = (data: Record<string, unknown>[], pageNumber = 1, hasMore = false) => ({
  data,
  has_more: hasMore,
  limit: 50,
  page: pageNumber,
})

const openSelector = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole('button', {
      name: 'common.operation.add workflow.nodes.knowledgeRetrievalV2.knowledgeSpaces',
    }),
  )
  return screen.getByRole('dialog')
}

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => renderWithConsoleQuery(ui)

describe('AddKnowledgeSpace', () => {
  beforeEach(() => {
    listSpaces.mockReset()
    listSpaces.mockResolvedValue(
      page([
        space('space-1', 'Product docs', {
          technical_summary: {
            icon: '📘',
            knowledge_space_id: 'space-1',
            name: 'Product docs',
            revision: 1,
            slug: 'space-1',
          },
        }),
        space('space-2', 'Archived docs', { technical_status: 'unavailable' }),
      ]),
    )
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
    await within(dialog).findByRole('checkbox', { name: 'Product docs' })
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
    const product = await within(dialog).findByRole('checkbox', { name: 'Product docs' })
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
    listSpaces.mockResolvedValue(page([space('space-3', 'Read-only docs', overrides)]))
    render(<AddKnowledgeSpace selectedSpaces={[]} onChange={onChange} />)

    const dialog = await openSelector(user)
    const restricted = await within(dialog).findByRole('checkbox', { name: 'Read-only docs' })
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
    listSpaces.mockRejectedValueOnce(new Error('spaces unavailable'))
    render(<AddKnowledgeSpace selectedSpaces={[]} onChange={vi.fn()} />)

    const dialog = await openSelector(user)
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('workflow.nodes.knowledgeRetrievalV2.loadSpacesError')
    expect(
      within(dialog).queryByText('workflow.nodes.knowledgeRetrievalV2.noSpaces'),
    ).not.toBeInTheDocument()
    await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))
    expect(
      await within(dialog).findByRole('checkbox', { name: 'Product docs' }),
    ).toBeInTheDocument()
  })

  it('keeps loaded spaces and offers a retry when the next page fails', async () => {
    const user = userEvent.setup()
    listSpaces.mockImplementation(async ({ query }: { query: { page: number } }) => {
      if (query.page === 1) return page([space('space-1', 'Product docs')], 1, true)
      throw new Error('next page unavailable')
    })
    render(<AddKnowledgeSpace selectedSpaces={[]} onChange={vi.fn()} />)

    const dialog = await openSelector(user)
    const alert = await within(dialog).findByRole('alert')
    expect(within(dialog).getByRole('checkbox', { name: 'Product docs' })).toBeInTheDocument()
    listSpaces.mockResolvedValue(page([space('space-4', 'Later docs')], 2))
    await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))

    expect(await within(dialog).findByRole('checkbox', { name: 'Later docs' })).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Product docs' })).toBeInTheDocument()
    // The retry loads the failed page instead of reloading the first one.
    expect(listSpaces.mock.calls.filter(([input]) => input.query.page === 1)).toHaveLength(1)
  })
})
