import type { App } from '@/types/app'
import { appAction } from '../app'

vi.mock('@/service/apps', () => ({
  fetchAppList: vi.fn(),
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirectionPath: vi.fn((_isAdmin: boolean, app: { id: string }) => `/app/${app.id}`),
}))

vi.mock('../../../app/type-selector', () => ({
  AppTypeIcon: () => null,
}))

describe('appAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(appAction.key).toBe('@app')
    expect(appAction.shortcut).toBe('@app')
  })

  it('returns parsed app results on success', async () => {
    const { fetchAppList } = await import('@/service/apps')
    vi.mocked(fetchAppList).mockResolvedValue({
      data: [
        { id: 'app-1', name: 'My App', description: 'A great app', mode: 'chat', icon: '', icon_type: 'emoji', icon_background: '', icon_url: '' } as unknown as App,
      ],
      has_more: false,
      limit: 10,
      page: 1,
      total: 1,
    })

    const results = await appAction.search('@app test', 'test', 'en')

    expect(fetchAppList).toHaveBeenCalledWith({
      url: 'apps',
      params: { page: 1, name: 'test' },
    })
    expect(results).toHaveLength(5)
    expect(results[0]).toMatchObject({
      id: 'app-1',
      title: 'My App',
      type: 'app',
    })
    expect(results.slice(1).map(r => r.id)).toEqual([
      'app-1:configuration',
      'app-1:overview',
      'app-1:logs',
      'app-1:develop',
    ])
  })

  it('returns workflow sub-sections for workflow-mode apps', async () => {
    const { fetchAppList } = await import('@/service/apps')
    vi.mocked(fetchAppList).mockResolvedValue({
      data: [
        { id: 'wf-1', name: 'Flow', description: '', mode: 'workflow', icon: '', icon_type: 'emoji', icon_background: '', icon_url: '' } as unknown as App,
      ],
      has_more: false,
      limit: 10,
      page: 1,
      total: 1,
    })

    const results = await appAction.search('@app', '', 'en')

    expect(results).toHaveLength(4)
    expect(results.slice(1).map(r => r.id)).toEqual([
      'wf-1:workflow',
      'wf-1:overview',
      'wf-1:logs',
    ])
  })

  it('returns apps without sub-sections for unscoped queries', async () => {
    const { fetchAppList } = await import('@/service/apps')
    vi.mocked(fetchAppList).mockResolvedValue({
      data: [
        { id: 'app-1', name: 'My App', description: '', mode: 'chat', icon: '', icon_type: 'emoji', icon_background: '', icon_url: '' } as unknown as App,
        { id: 'app-2', name: 'Other', description: '', mode: 'chat', icon: '', icon_type: 'emoji', icon_background: '', icon_url: '' } as unknown as App,
      ],
      has_more: false,
      limit: 10,
      page: 1,
      total: 2,
    })

    const results = await appAction.search('my app', 'my app', 'en')

    expect(results).toHaveLength(2)
    expect(results.map(r => r.id)).toEqual(['app-1', 'app-2'])
  })

  it('returns empty array when response has no data', async () => {
    const { fetchAppList } = await import('@/service/apps')
    vi.mocked(fetchAppList).mockResolvedValue({ data: [], has_more: false, limit: 10, page: 1, total: 0 })

    const results = await appAction.search('@app', '', 'en')
    expect(results).toEqual([])
  })

  it('returns empty array on API failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetchAppList } = await import('@/service/apps')
    vi.mocked(fetchAppList).mockRejectedValue(new Error('network error'))

    const results = await appAction.search('@app fail', 'fail', 'en')
    expect(results).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('App search failed:', expect.any(Error))
    warnSpy.mockRestore()
  })
})
