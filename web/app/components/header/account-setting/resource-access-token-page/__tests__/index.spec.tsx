import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import ResourceAccessTokenPage from '../index'

const mocks = vi.hoisted(() => ({
  createResourceAccessToken: vi.fn(),
  deleteResourceAccessTokenRelation: vi.fn(),
  listApps: vi.fn(),
  listDatasets: vi.fn(),
  listResourceAccessTokens: vi.fn(),
  updateResourceAccessToken: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    apps: {
      get: {
        queryOptions: (options?: unknown) => ({
          enabled: (options as { enabled?: boolean } | undefined)?.enabled,
          queryFn: mocks.listApps,
          queryKey: ['apps'],
        }),
      },
    },
    datasets: {
      get: {
        queryOptions: (options?: unknown) => ({
          enabled: (options as { enabled?: boolean } | undefined)?.enabled,
          queryFn: mocks.listDatasets,
          queryKey: ['datasets'],
        }),
      },
    },
    resourceAccessTokens: {
      get: {
        key: () => ['resource-access-tokens'],
        queryOptions: (options?: unknown) => ({
          queryFn: () => mocks.listResourceAccessTokens(options),
          queryKey: ['resource-access-tokens', options],
        }),
      },
      post: {
        mutationOptions: () => ({
          mutationFn: mocks.createResourceAccessToken,
        }),
      },
      byTokenId: {
        patch: {
          mutationOptions: () => ({
            mutationFn: mocks.updateResourceAccessToken,
          }),
        },
        relations: {
          byRelationId: {
            delete: {
              mutationOptions: () => ({
                mutationFn: mocks.deleteResourceAccessTokenRelation,
              }),
            },
          },
        },
      },
    },
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

const renderWithQueryClient = (children: ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

describe('ResourceAccessTokenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listResourceAccessTokens.mockResolvedValue({
      data: [
        {
          created_at: 1787000000,
          last_used_at: null,
          masked_token: 'sk-12345...abcd',
          name: 'Production clients',
          relation_id: 'relation-1',
          resource_id: 'app-1',
          resource_name: 'Support Bot',
          resource_type: 'app',
          token_id: 'token-1',
          track_id: 'track-one',
        },
        {
          created_at: 1787000000,
          last_used_at: null,
          masked_token: 'sk-12345...abcd',
          name: 'Production clients',
          relation_id: 'relation-2',
          resource_id: 'dataset-1',
          resource_name: 'Help Center',
          resource_type: 'knowledge',
          token_id: 'token-1',
          track_id: 'track-one',
        },
      ],
      has_more: false,
      limit: 20,
      page: 1,
      total: 1,
    })
    mocks.listApps.mockResolvedValue({
      data: [{ id: 'app-2', name: 'Sales Bot' }],
      has_more: false,
      limit: 100,
      page: 1,
      total: 1,
    })
    mocks.listDatasets.mockResolvedValue({
      data: [
        { enable_api: true, id: 'dataset-2', name: 'Sales Docs' },
        { enable_api: false, id: 'dataset-disabled', name: 'Hidden Docs' },
      ],
      has_more: false,
      limit: 100,
      page: 1,
      total: 2,
    })
  })

  it('renders one row per token with an accessible resource summary', async () => {
    renderWithQueryClient(<ResourceAccessTokenPage />)

    expect(await screen.findByText('Production clients')).toBeInTheDocument()
    expect(
      screen.getByText(
        'common.resourceAccessToken.appCount:{"count":1} · common.resourceAccessToken.knowledgeCount:{"count":1}',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('track-on ...')).toBeInTheDocument()
    expect(screen.getByText('sk-12345...abcd')).toBeInTheDocument()
    expect(screen.queryByText('Support Bot')).not.toBeInTheDocument()
    expect(screen.queryByText('Help Center')).not.toBeInTheDocument()
  })

  it('renders the empty state without the table when there are no access tokens', async () => {
    mocks.listResourceAccessTokens.mockResolvedValue({
      data: [],
      has_more: false,
      limit: 20,
      page: 1,
      total: 0,
    })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    expect(await screen.findByText('common.resourceAccessToken.empty')).toBeInTheDocument()
    expect(screen.getByText('common.resourceAccessToken.emptyDescription')).toBeInTheDocument()
    expect(screen.queryByText('common.resourceAccessToken.name')).not.toBeInTheDocument()
    expect(
      screen.queryByText('common.resourceAccessToken.total:{"total":0}'),
    ).not.toBeInTheDocument()
  })

  it('filters tokens by bound resource name', async () => {
    const user = userEvent.setup()
    mocks.listResourceAccessTokens.mockResolvedValue({
      data: [
        {
          created_at: 1787000000,
          last_used_at: null,
          masked_token: 'sk-12345...abcd',
          name: 'Production clients',
          relation_id: 'relation-1',
          resource_id: 'app-1',
          resource_name: 'Support Bot',
          resource_type: 'app',
          token_id: 'token-1',
          track_id: 'track-one',
        },
        {
          created_at: 1787000000,
          last_used_at: null,
          masked_token: 'sk-56789...efgh',
          name: 'CLI automation',
          relation_id: 'relation-2',
          resource_id: 'dataset-1',
          resource_name: 'Help Center',
          resource_type: 'knowledge',
          token_id: 'token-2',
          track_id: 'track-two',
        },
      ],
      has_more: false,
      limit: 20,
      page: 1,
      total: 2,
    })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await screen.findByText('Production clients')
    await user.type(screen.getByRole('searchbox'), 'help')

    expect(screen.queryByText('Production clients')).not.toBeInTheDocument()
    expect(screen.getByText('CLI automation')).toBeInTheDocument()
  })

  it('creates one token for selected app and knowledge resources', async () => {
    const user = userEvent.setup()
    mocks.createResourceAccessToken.mockResolvedValue({
      data: [],
      token: 'sk-new-token',
    })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await user.click(
      await screen.findByRole('button', { name: 'common.resourceAccessToken.createButton' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'common.operation.create' })).toBeDisabled()

    await user.type(within(dialog).getByLabelText('common.resourceAccessToken.name'), 'Partners')
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Sales Bot' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Sales Docs' }))
    expect(within(dialog).queryByRole('checkbox', { name: 'Hidden Docs' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(mocks.createResourceAccessToken).toHaveBeenCalledWith(
        {
          body: {
            name: 'Partners',
            resources: [
              { id: 'app-2', type: 'app' },
              { id: 'dataset-2', type: 'knowledge' },
            ],
          },
        },
        expect.anything(),
      )
    })
    expect(await within(dialog).findByText('sk-new-token')).toBeInTheDocument()
    expect(
      within(dialog).getByText('common.resourceAccessToken.createdTokenDescription'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'common.resourceAccessToken.done' }),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.copy' }))
    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith('sk-new-token')
    })
  })

  it('separates apps and knowledge bases in the create dialog and searches both types', async () => {
    const user = userEvent.setup()
    mocks.listApps.mockResolvedValue({
      data: [
        { id: 'app-2', name: 'Sales Bot' },
        { id: 'app-3', name: 'Support Bot' },
      ],
      has_more: false,
      limit: 100,
      page: 1,
      total: 2,
    })
    mocks.listDatasets.mockResolvedValue({
      data: [
        { enable_api: true, id: 'dataset-2', name: 'Sales Docs' },
        { enable_api: true, id: 'dataset-3', name: 'Support Docs' },
      ],
      has_more: false,
      limit: 100,
      page: 1,
      total: 2,
    })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await user.click(
      await screen.findByRole('button', { name: 'common.resourceAccessToken.createButton' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(
      await within(dialog).findByText('common.resourceAccessToken.appsSection'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('common.resourceAccessToken.knowledgeBasesSection'),
    ).toBeInTheDocument()

    await user.type(within(dialog).getByRole('searchbox'), 'sales')
    expect(within(dialog).getByRole('checkbox', { name: 'Sales Bot' })).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Sales Docs' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Support Bot' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Support Docs' })).not.toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('tab', { name: 'common.resourceAccessToken.tabApps' }),
    )
    expect(within(dialog).getByRole('checkbox', { name: 'Sales Bot' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Sales Docs' })).not.toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('tab', { name: 'common.resourceAccessToken.tabKnowledgeBases' }),
    )
    expect(within(dialog).queryByRole('checkbox', { name: 'Sales Bot' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Sales Docs' })).toBeInTheDocument()
  })

  it('edits the token name and selected resources for the selected row', async () => {
    const user = userEvent.setup()
    mocks.updateResourceAccessToken.mockResolvedValue({
      data: [],
      has_more: false,
      limit: 1,
      page: 1,
      total: 1,
    })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await screen.findByText('Production clients')
    await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('checkbox', { name: 'Support Bot' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Help Center' })).toBeChecked()
    expect(
      within(dialog).getByText('common.dynamicSelect.selected:{"count":2}'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Help Center' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Sales Bot' }))
    await user.clear(within(dialog).getByLabelText('common.resourceAccessToken.name'))
    await user.type(within(dialog).getByLabelText('common.resourceAccessToken.name'), 'Renamed')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mocks.updateResourceAccessToken).toHaveBeenCalledWith(
        {
          body: {
            name: 'Renamed',
            resources: [
              { id: 'app-2', type: 'app' },
              { id: 'app-1', type: 'app' },
            ],
          },
          params: { token_id: 'token-1' },
        },
        expect.anything(),
      )
    })
  })

  it('deletes the selected token', async () => {
    const user = userEvent.setup()
    mocks.deleteResourceAccessTokenRelation.mockResolvedValue(undefined)
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await screen.findByText('Production clients')
    await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[0]!)
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.deleteResourceAccessTokenRelation).toHaveBeenCalledWith(
        {
          params: {
            relation_id: 'relation-1',
            token_id: 'token-1',
          },
        },
        expect.anything(),
      )
    })
  })
})
