import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type {
  GetResourceAccessTokensData,
  ResourceAccessTokenListResponse,
  ResourceAccessTokenRowResponse,
} from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
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
    account: {
      profile: {
        get: {
          queryKey: () => [['console', 'account', 'profile', 'get'], { type: 'query' }],
        },
      },
    },
    apps: {
      get: {
        queryOptions: (options?: unknown) => ({
          enabled: (options as { enabled?: boolean } | undefined)?.enabled,
          queryFn: mocks.listApps,
          queryKey: ['apps'],
        }),
        infiniteOptions: (options: unknown) => {
          const query = options as {
            enabled?: boolean
            getNextPageParam: (page: { has_more: boolean; page: number }) => number | undefined
            initialPageParam: number
            input: (page: number) => unknown
          }
          return {
            enabled: query.enabled,
            getNextPageParam: query.getNextPageParam,
            initialPageParam: query.initialPageParam,
            queryFn: ({ pageParam }: { pageParam: number }) =>
              mocks.listApps(query.input(pageParam)),
            queryKey: ['apps', query.input(query.initialPageParam)],
          }
        },
      },
    },
    datasets: {
      get: {
        queryOptions: (options?: unknown) => ({
          enabled: (options as { enabled?: boolean } | undefined)?.enabled,
          queryFn: mocks.listDatasets,
          queryKey: ['datasets'],
        }),
        infiniteOptions: (options: unknown) => {
          const query = options as {
            enabled?: boolean
            getNextPageParam: (page: { has_more: boolean; page: number }) => number | undefined
            initialPageParam: number
            input: (page: number) => unknown
          }
          return {
            enabled: query.enabled,
            getNextPageParam: query.getNextPageParam,
            initialPageParam: query.initialPageParam,
            queryFn: ({ pageParam }: { pageParam: number }) =>
              mocks.listDatasets(query.input(pageParam)),
            queryKey: ['datasets', query.input(query.initialPageParam)],
          }
        },
      },
    },
    resourceAccessTokens: {
      get: {
        key: () => ['resource-access-tokens'],
        queryOptions: (options?: {
          input: Pick<GetResourceAccessTokensData, 'query'>
          placeholderData?: (
            previousData: ResourceAccessTokenListResponse | undefined,
          ) => ResourceAccessTokenListResponse | undefined
        }) => ({
          placeholderData: options?.placeholderData,
          queryFn: () => mocks.listResourceAccessTokens(options),
          queryKey: ['resource-access-tokens', options?.input],
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

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { default: time } = await import('@/i18n/locales/en-US/time.json')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...actual,
    ...createReactI18nextMock({
      'time.dateFormats.compact': time['dateFormats.compact'],
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

const createTokenRow = (
  overrides: Partial<ResourceAccessTokenRowResponse> = {},
): ResourceAccessTokenRowResponse => ({
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
  ...overrides,
})

const renderWithQueryClient = (children: ReactNode) => {
  const queryClient = createAccountProfileQueryClient()

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
        'accountSettings.resourceAccessToken.appCount:{"count":1} · accountSettings.resourceAccessToken.knowledgeCount:{"count":1}',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'track-one' })).toBeInTheDocument()
    expect(screen.getByText('sk-12345...abcd')).toBeInTheDocument()
    expect(
      screen.getByText('accountSettings.resourceAccessToken.accessibleResources'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', {
        name: 'accountSettings.resourceAccessToken.createdColumn',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Support Bot')).not.toBeInTheDocument()
    expect(screen.queryByText('Help Center')).not.toBeInTheDocument()
  })

  it('formats the creation time for the interface language and account timezone', async () => {
    mocks.listResourceAccessTokens.mockResolvedValue({
      data: [createTokenRow({ created_at: Date.UTC(2026, 8, 30, 20, 30) / 1000 })],
      has_more: false,
      limit: 20,
      page: 1,
      total: 1,
    } satisfies ResourceAccessTokenListResponse)
    renderWithQueryClient(<ResourceAccessTokenPage />)

    const row = await screen.findByRole('row', { name: /Production clients/ })
    expect(within(row).getByRole('cell', { name: '10/01/2026 04:30' })).toBeInTheDocument()
  })

  it('shows bound app and dataset names when hovering over the resource information', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await user.hover(
      await screen.findByRole('button', {
        name: 'Production clients · accountSettings.resourceAccessToken.accessibleResources',
      }),
    )

    expect(await screen.findByText('Support Bot')).toBeInTheDocument()
    expect(
      within(
        screen.getByRole('list', { name: 'accountSettings.resourceAccessToken.appsSection' }),
      ).getByText('Support Bot'),
    ).toBeInTheDocument()
    expect(
      within(
        screen.getByRole('list', {
          name: 'accountSettings.resourceAccessToken.knowledgeBasesSection',
        }),
      ).getByText('Help Center'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Sales Bot')).not.toBeInTheDocument()
    expect(mocks.listApps).not.toHaveBeenCalled()
    expect(mocks.listDatasets).not.toHaveBeenCalled()
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

    expect(await screen.findByText('accountSettings.resourceAccessToken.empty')).toBeInTheDocument()
    expect(
      screen.getByText('accountSettings.resourceAccessToken.emptyDescription'),
    ).toBeInTheDocument()
    expect(screen.queryByText('accountSettings.resourceAccessToken.name')).not.toBeInTheDocument()
    expect(
      screen.queryByText('accountSettings.resourceAccessToken.total:{"total":0}'),
    ).not.toBeInTheDocument()
  })

  it('shows a retryable error instead of an empty list when loading tokens fails', async () => {
    const user = userEvent.setup()
    mocks.listResourceAccessTokens
      .mockRejectedValueOnce(new Error('Request failed'))
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
        limit: 20,
        page: 1,
        total: 0,
      })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'accountSettings.resourceAccessToken.loadError',
    )
    expect(screen.queryByText('accountSettings.resourceAccessToken.empty')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(await screen.findByText('accountSettings.resourceAccessToken.empty')).toBeInTheDocument()
    expect(mocks.listResourceAccessTokens).toHaveBeenCalledTimes(2)
  })

  it('shows server search results for a bound resource name', async () => {
    const user = userEvent.setup()
    const rows = [
      createTokenRow(),
      createTokenRow({
        masked_token: 'sk-56789...efgh',
        name: 'CLI automation',
        relation_id: 'relation-2',
        resource_id: 'dataset-1',
        resource_name: 'Help Center',
        resource_type: 'knowledge',
        token_id: 'token-2',
        track_id: 'track-two',
      }),
    ]
    mocks.listResourceAccessTokens.mockImplementation(
      ({ input }: { input: Pick<GetResourceAccessTokensData, 'query'> }) => {
        const keyword = input.query?.keyword?.toLowerCase() ?? ''
        const data = rows.filter((row) => row.resource_name.toLowerCase().includes(keyword))
        return Promise.resolve({
          data,
          has_more: false,
          limit: 20,
          page: 1,
          total: data.length,
        } satisfies ResourceAccessTokenListResponse)
      },
    )
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await screen.findByText('Production clients')
    await user.type(screen.getByRole('searchbox'), 'help')

    await waitFor(() => {
      expect(mocks.listResourceAccessTokens).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: { query: expect.objectContaining({ keyword: 'help' }) },
        }),
      )
    })
    expect(await screen.findByText('CLI automation')).toBeInTheDocument()
    expect(
      await screen.findByText('accountSettings.resourceAccessToken.total:{"total":1}'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Production clients')).not.toBeInTheDocument()
  })

  it('shows a complete token search match and resets pagination', async () => {
    const user = userEvent.setup()
    const completeToken = 'sk-12345678-1234-1234-1234-12345678abcd'
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      createTokenRow({
        name: `Client ${index + 1}`,
        relation_id: `relation-${index + 2}`,
        token_id: `token-${index + 2}`,
        track_id: `track-${index + 2}`,
      }),
    )
    mocks.listResourceAccessTokens.mockImplementation(
      ({ input }: { input: Pick<GetResourceAccessTokensData, 'query'> }) => {
        const page = input.query?.page ?? 1
        const total = input.query?.keyword ? 1 : 21
        return Promise.resolve({
          data:
            input.query?.keyword === completeToken || page === 2 ? [createTokenRow()] : firstPage,
          has_more: page * 20 < total,
          limit: 20,
          page,
          total,
        } satisfies ResourceAccessTokenListResponse)
      },
    )
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await screen.findByText('Client 1')
    expect(
      within(screen.getByRole('navigation')).getByRole('button', {
        name: 'common.pagination.editPageNumber:{"page":1,"totalPages":2}',
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'accountSettings.resourceAccessToken.next',
      }),
    )
    await screen.findByText('Production clients')
    await user.type(screen.getByRole('searchbox'), completeToken)

    await waitFor(() => {
      expect(mocks.listResourceAccessTokens).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: { query: { keyword: completeToken, limit: 20, page: 1 } },
        }),
      )
    })
    expect(await screen.findByText('Production clients')).toBeInTheDocument()
    expect(
      await screen.findByText('accountSettings.resourceAccessToken.total:{"total":1}'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'accountSettings.resourceAccessToken.previous',
      }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: 'accountSettings.resourceAccessToken.next',
      }),
    ).toBeDisabled()
  })

  it('keeps the current rows and total visible until search results arrive', async () => {
    const user = userEvent.setup()
    let resolveSearch!: (response: ResourceAccessTokenListResponse) => void
    const searchRequest = new Promise<ResourceAccessTokenListResponse>((resolve) => {
      resolveSearch = resolve
    })
    mocks.listResourceAccessTokens.mockImplementation(
      ({ input }: { input: Pick<GetResourceAccessTokensData, 'query'> }) =>
        input.query?.keyword
          ? searchRequest
          : Promise.resolve({
              data: [createTokenRow()],
              has_more: false,
              limit: 20,
              page: 1,
              total: 1,
            } satisfies ResourceAccessTokenListResponse),
    )
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await screen.findByText('Production clients')
    await user.type(screen.getByRole('searchbox'), 'automation')
    await waitFor(() => {
      expect(mocks.listResourceAccessTokens).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: { query: { keyword: 'automation', limit: 20, page: 1 } },
        }),
      )
    })
    expect(screen.getByText('Production clients')).toBeInTheDocument()
    expect(
      screen.getByText('accountSettings.resourceAccessToken.total:{"total":1}'),
    ).toBeInTheDocument()
    expect(screen.queryByText('accountSettings.resourceAccessToken.empty')).not.toBeInTheDocument()

    await act(async () => {
      resolveSearch({
        data: [
          createTokenRow({ name: 'CLI automation' }),
          createTokenRow({
            name: 'Staging automation',
            relation_id: 'relation-2',
            token_id: 'token-2',
          }),
        ],
        has_more: false,
        limit: 20,
        page: 1,
        total: 2,
      })
    })

    expect(await screen.findByText('CLI automation')).toBeInTheDocument()
    expect(screen.getByText('Staging automation')).toBeInTheDocument()
    expect(
      screen.getByText('accountSettings.resourceAccessToken.total:{"total":2}'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Production clients')).not.toBeInTheDocument()
  })

  it('keeps the table visible when clearing an empty search until the list reloads', async () => {
    const user = userEvent.setup()
    const queryClient = createAccountProfileQueryClient()
    queryClient.setQueryDefaults(['resource-access-tokens'], { gcTime: 0 })
    const listResponse = {
      data: [createTokenRow()],
      has_more: false,
      limit: 20,
      page: 1,
      total: 1,
    } satisfies ResourceAccessTokenListResponse
    let resolveReload!: (response: ResourceAccessTokenListResponse) => void
    const reloadRequest = new Promise<ResourceAccessTokenListResponse>((resolve) => {
      resolveReload = resolve
    })
    mocks.listResourceAccessTokens
      .mockResolvedValueOnce(listResponse)
      .mockImplementation(({ input }: { input: Pick<GetResourceAccessTokensData, 'query'> }) =>
        input.query?.keyword
          ? Promise.resolve({ ...listResponse, data: [], total: 0 })
          : reloadRequest,
      )
    render(
      <QueryClientProvider client={queryClient}>
        <ResourceAccessTokenPage />
      </QueryClientProvider>,
    )

    await screen.findByText('Production clients')
    await user.type(screen.getByRole('searchbox'), 'missing')
    await screen.findByText('accountSettings.resourceAccessToken.total:{"total":0}')
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.queryByText('accountSettings.resourceAccessToken.emptyDescription'),
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.listResourceAccessTokens).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: { query: { keyword: undefined, limit: 20, page: 1 } },
        }),
      )
    })
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.getByText('accountSettings.resourceAccessToken.total:{"total":0}'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('accountSettings.resourceAccessToken.emptyDescription'),
    ).not.toBeInTheDocument()

    await act(async () => {
      resolveReload(listResponse)
    })

    expect(await screen.findByText('Production clients')).toBeInTheDocument()
    expect(
      screen.getByText('accountSettings.resourceAccessToken.total:{"total":1}'),
    ).toBeInTheDocument()
  })

  it('loads additional API-enabled apps from later pages', async () => {
    const user = userEvent.setup()
    mocks.listApps
      .mockResolvedValueOnce({
        data: [{ id: 'app-2', name: 'Sales Bot' }],
        has_more: true,
        limit: 100,
        page: 1,
        total: 2,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'app-3', name: 'More Sales Bot' }],
        has_more: false,
        limit: 100,
        page: 2,
        total: 2,
      })
    renderWithQueryClient(<ResourceAccessTokenPage />)
    await user.click(
      await screen.findByRole('button', {
        name: 'accountSettings.resourceAccessToken.createButton',
      }),
    )
    const dialog = screen.getByRole('dialog')
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'accountSettings.resourceAccessToken.loadMore',
      }),
    )

    expect(
      await within(dialog).findByRole('checkbox', { name: 'More Sales Bot' }),
    ).toBeInTheDocument()
    expect(mocks.listApps).toHaveBeenLastCalledWith({
      query: { limit: 100, name: undefined, openapi_visible: true, page: 2 },
    })
  })

  it('creates one token for selected app and knowledge resources', async () => {
    const user = userEvent.setup()
    mocks.createResourceAccessToken.mockResolvedValue({
      data: [],
      token: 'sk-new-token',
    })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await user.click(
      await screen.findByRole('button', {
        name: 'accountSettings.resourceAccessToken.createButton',
      }),
    )
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'common.operation.create' })).toBeDisabled()

    await user.type(
      within(dialog).getByLabelText('accountSettings.resourceAccessToken.name'),
      'Partners',
    )
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
      within(dialog).getByText('accountSettings.resourceAccessToken.createdTokenDescription'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'accountSettings.resourceAccessToken.done' }),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.copy' }))
    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith('sk-new-token')
    })
  })

  it.each(['create', 'edit'] as const)(
    'submits resources selected across server searches in %s mode',
    async (mode) => {
      const user = userEvent.setup()
      const apps = [
        { id: 'app-2', name: 'Sales Bot' },
        { id: 'app-3', name: 'Finance Bot' },
      ]
      mocks.listApps.mockImplementation(({ query }: Pick<GetAppsData, 'query'>) => {
        const data = apps.filter((app) =>
          app.name.toLowerCase().includes(query?.name?.toLowerCase() ?? ''),
        )
        return Promise.resolve({ data, has_more: false, limit: 100, page: 1, total: data.length })
      })
      mocks.listDatasets.mockResolvedValue({
        data: [],
        has_more: false,
        limit: 100,
        page: 1,
        total: 0,
      })
      mocks.createResourceAccessToken.mockResolvedValue({ data: [], token: 'sk-new-token' })
      mocks.updateResourceAccessToken.mockResolvedValue({
        data: [],
        has_more: false,
        limit: 20,
        page: 1,
        total: 0,
      })
      renderWithQueryClient(<ResourceAccessTokenPage />)

      if (mode === 'create') {
        await user.click(
          await screen.findByRole('button', {
            name: 'accountSettings.resourceAccessToken.createButton',
          }),
        )
      } else {
        await screen.findByText('Production clients')
        await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      }
      const dialog = screen.getByRole('dialog')
      if (mode === 'create') {
        await user.type(
          within(dialog).getByLabelText('accountSettings.resourceAccessToken.name'),
          'Partners',
        )
      }
      await user.click(await within(dialog).findByRole('checkbox', { name: 'Sales Bot' }))
      await user.type(within(dialog).getByRole('searchbox'), 'finance')
      await waitFor(() => {
        expect(mocks.listApps).toHaveBeenLastCalledWith({
          query: { limit: 100, name: 'finance', openapi_visible: true, page: 1 },
        })
      })
      await user.click(await within(dialog).findByRole('checkbox', { name: 'Finance Bot' }))
      const count = mode === 'create' ? 2 : 4
      expect(
        within(dialog).getByText(`common.dynamicSelect.selected:{"count":${count}}`),
      ).toBeInTheDocument()
      await user.click(
        within(dialog).getByRole('button', {
          name: mode === 'create' ? 'common.operation.create' : 'common.operation.save',
        }),
      )

      const mutation =
        mode === 'create' ? mocks.createResourceAccessToken : mocks.updateResourceAccessToken
      const resources = [
        { id: 'app-2', type: 'app' },
        { id: 'app-3', type: 'app' },
        ...(mode === 'edit'
          ? [
              { id: 'app-1', type: 'app' },
              { id: 'dataset-1', type: 'knowledge' },
            ]
          : []),
      ]
      await waitFor(() => {
        expect(mutation).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({ resources: expect.arrayContaining(resources) }),
          }),
          expect.anything(),
        )
      })
    },
  )

  it('submits selected resources when the current search has no results', async () => {
    const user = userEvent.setup()
    mocks.listApps.mockImplementation(({ query }: Pick<GetAppsData, 'query'>) =>
      Promise.resolve({
        data: query?.name ? [] : [{ id: 'app-2', name: 'Sales Bot' }],
        has_more: false,
        limit: 100,
        page: 1,
        total: query?.name ? 0 : 1,
      }),
    )
    mocks.listDatasets.mockResolvedValue({
      data: [],
      has_more: false,
      limit: 100,
      page: 1,
      total: 0,
    })
    mocks.createResourceAccessToken.mockResolvedValue({ data: [], token: 'sk-new-token' })
    renderWithQueryClient(<ResourceAccessTokenPage />)

    await user.click(
      await screen.findByRole('button', {
        name: 'accountSettings.resourceAccessToken.createButton',
      }),
    )
    const dialog = screen.getByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('accountSettings.resourceAccessToken.name'),
      'Partners',
    )
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Sales Bot' }))
    await user.type(within(dialog).getByRole('searchbox'), 'missing')
    await within(dialog).findByText('accountSettings.resourceAccessToken.noResources')
    const createButton = within(dialog).getByRole('button', { name: 'common.operation.create' })
    expect(createButton).toBeEnabled()
    await user.click(createButton)

    await waitFor(() => {
      expect(mocks.createResourceAccessToken).toHaveBeenCalledWith(
        { body: { name: 'Partners', resources: [{ id: 'app-2', type: 'app' }] } },
        expect.anything(),
      )
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
      await screen.findByRole('button', {
        name: 'accountSettings.resourceAccessToken.createButton',
      }),
    )
    const dialog = screen.getByRole('dialog')
    expect(
      await within(dialog).findByText('accountSettings.resourceAccessToken.appsSection'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('accountSettings.resourceAccessToken.knowledgeBasesSection'),
    ).toBeInTheDocument()

    await user.type(within(dialog).getByRole('searchbox'), 'sales')
    expect(within(dialog).getByRole('checkbox', { name: 'Sales Bot' })).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Sales Docs' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Support Bot' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Support Docs' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.listApps).toHaveBeenLastCalledWith({
        query: { limit: 100, name: 'sales', openapi_visible: true, page: 1 },
      })
      expect(mocks.listDatasets).toHaveBeenLastCalledWith({
        query: { include_all: true, keyword: 'sales', limit: 100, page: 1 },
      })
    })

    await user.click(
      within(dialog).getByRole('tab', { name: 'accountSettings.resourceAccessToken.tabApps' }),
    )
    expect(within(dialog).getByRole('checkbox', { name: 'Sales Bot' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Sales Docs' })).not.toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('tab', {
        name: 'accountSettings.resourceAccessToken.tabKnowledgeBases',
      }),
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
    await user.clear(within(dialog).getByLabelText('accountSettings.resourceAccessToken.name'))
    await user.type(
      within(dialog).getByLabelText('accountSettings.resourceAccessToken.name'),
      'Renamed',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mocks.updateResourceAccessToken).toHaveBeenCalledWith(
        {
          body: {
            name: 'Renamed',
            resources: [
              { id: 'app-1', type: 'app' },
              { id: 'app-2', type: 'app' },
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
    const dialog = screen.getByRole('alertdialog')
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
