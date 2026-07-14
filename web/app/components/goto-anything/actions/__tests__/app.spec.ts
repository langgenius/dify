import { appAction, appSearchQueryOptions } from '../app'

const serviceMocks = vi.hoisted(() => ({ queryOptions: vi.fn((options) => options) }))

vi.mock('@/service/client', () => ({
  consoleQuery: { apps: { get: { queryOptions: serviceMocks.queryOptions } } },
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirectionPath: vi.fn((app: { id: string }) => `/app/${app.id}`),
}))

vi.mock('../../../app/type-selector', () => ({ AppTypeIcon: () => null }))

type AppQueryResponse = Parameters<
  NonNullable<ReturnType<typeof appSearchQueryOptions>['select']>
>[0]
type AppQueryItem = AppQueryResponse['data'][number]

function app(overrides: Partial<AppQueryItem> = {}): AppQueryItem {
  return {
    id: 'app-1',
    name: 'My App',
    description: 'A great app',
    mode: 'chat',
    icon: '',
    icon_type: 'emoji',
    icon_background: '',
    icon_url: '',
    ...overrides,
  } as AppQueryItem
}

function response(data: AppQueryItem[]): AppQueryResponse {
  return { data, has_more: false, limit: 10, page: 1, total: data.length }
}

describe('app search query', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes remote action metadata', () => {
    expect(appAction).toMatchObject({ key: '@app', shortcut: '@app', source: 'remote' })
  })

  it('builds generated query options from the search term', () => {
    appSearchQueryOptions('assistant', false)

    expect(serviceMocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { query: { page: 1, name: 'assistant' } },
        select: expect.any(Function),
      }),
    )
  })

  it('selects plain app results for general search', () => {
    const options = appSearchQueryOptions('my app', false)

    expect(options.select!(response([app(), app({ id: 'app-2', name: 'Other' })]))).toHaveLength(2)
  })

  it('selects app sections only for scoped search', () => {
    const chatOptions = appSearchQueryOptions('', true)
    const workflowOptions = appSearchQueryOptions('', true)

    expect(chatOptions.select!(response([app()])).map((result) => result.id)).toEqual([
      'app-1',
      'app-1:configuration',
      'app-1:overview',
      'app-1:logs',
      'app-1:develop',
    ])
    expect(
      workflowOptions.select!(response([app({ id: 'wf-1', mode: 'workflow' })])).map(
        (result) => result.id,
      ),
    ).toEqual(['wf-1', 'wf-1:workflow', 'wf-1:overview', 'wf-1:logs'])
  })
})
