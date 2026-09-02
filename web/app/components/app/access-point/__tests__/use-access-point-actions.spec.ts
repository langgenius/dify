import { act, renderHook } from '@testing-library/react'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'
import { useAccessPointActions } from '../shared/use-access-point-actions'

const mocks = vi.hoisted(() => ({
  apiEnableMutation: vi.fn().mockResolvedValue({}),
  emit: vi.fn(),
  fetchAppDetail: vi.fn().mockResolvedValue({ id: 'app-1' }),
  getSocket: vi.fn(),
  onAppStateUpdate: vi.fn(() => vi.fn()),
  resetSiteAccessTokenMutation: vi.fn().mockResolvedValue({}),
  setAppDetail: vi.fn(),
  siteEnableMutation: vi.fn().mockResolvedValue({}),
  toast: vi.fn(),
  updateAppSiteConfig: vi.fn().mockResolvedValue({}),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: mocks.toast }))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppDetail: typeof mocks.setAppDetail }) => unknown) =>
    selector({ setAppDetail: mocks.setAppDetail }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: { onAppStateUpdate: mocks.onAppStateUpdate },
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: { getSocket: mocks.getSocket },
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetail: mocks.fetchAppDetail,
  updateAppSiteConfig: mocks.updateAppSiteConfig,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      get: { key: () => ['apps'] },
      recent: { get: { key: () => ['apps', 'recent'] } },
      starred: { get: { key: () => ['apps', 'starred'] } },
      byAppId: {
        get: {
          queryKey: ({ input }: { input: { params: { app_id: string } } }) => [
            'app-detail',
            input.params.app_id,
          ],
        },
        apiEnable: {
          post: {
            mutationOptions: () => ({ mutationFn: mocks.apiEnableMutation }),
          },
        },
        siteEnable: {
          post: {
            mutationOptions: () => ({ mutationFn: mocks.siteEnableMutation }),
          },
        },
        site: {
          accessTokenReset: {
            post: {
              mutationOptions: () => ({ mutationFn: mocks.resetSiteAccessTokenMutation }),
            },
          },
        },
      },
    },
  },
}))

function renderActions(appId = 'app-1', canEdit = true) {
  const queryClient = createTestQueryClient()
  const rendered = renderHook(() => useAccessPointActions(appId, canEdit), {
    wrapper: createQueryClientWrapper(queryClient),
  })

  return { ...rendered, queryClient }
}

describe('useAccessPointActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSocket.mockReturnValue({ emit: mocks.emit })
  })

  it('updates API status through the generated contract independently of app editing', async () => {
    const { queryClient, result } = renderActions('app-1', false)
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.changeApiStatus(true)
    })

    expect(mocks.apiEnableMutation.mock.calls[0]?.[0]).toEqual({
      params: { app_id: 'app-1' },
      body: { enable_api: true },
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-detail', 'app-1'] })
    expect(mocks.fetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
    expect(mocks.setAppDetail).toHaveBeenCalledWith({ id: 'app-1' })
    expect(mocks.emit).toHaveBeenCalledWith(
      'collaboration_event',
      expect.objectContaining({
        type: 'app_state_update',
        timestamp: expect.any(Number),
      }),
    )
    expect(mocks.toast).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully', {
      type: 'success',
    })
  })

  it('keeps site status changes behind app editing permission', async () => {
    const { result } = renderActions('app-1', false)

    await act(async () => {
      await result.current.changeSiteStatus(true)
    })

    expect(mocks.siteEnableMutation).not.toHaveBeenCalled()
  })

  it('updates site status through the generated contract', async () => {
    const { result } = renderActions()

    await act(async () => {
      await result.current.changeSiteStatus(false)
    })

    expect(mocks.siteEnableMutation.mock.calls[0]?.[0]).toEqual({
      params: { app_id: 'app-1' },
      body: { enable_site: false },
    })
  })

  it('resets the site access token through the generated contract', async () => {
    const { result } = renderActions()

    await act(async () => {
      await result.current.regenerateSiteCode()
    })

    expect(mocks.resetSiteAccessTokenMutation.mock.calls[0]?.[0]).toEqual({
      params: { app_id: 'app-1' },
    })
    expect(mocks.toast).toHaveBeenCalledWith('common.actionMsg.generatedSuccessfully', {
      type: 'success',
    })
  })

  it('reports mutation failure without refreshing or broadcasting stale state', async () => {
    mocks.apiEnableMutation.mockRejectedValueOnce(new Error('request failed'))
    const { queryClient, result } = renderActions()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.changeApiStatus(true)
    })

    expect(invalidateQueries).not.toHaveBeenCalled()
    expect(mocks.fetchAppDetail).not.toHaveBeenCalled()
    expect(mocks.getSocket).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully', {
      type: 'error',
    })
  })
})
