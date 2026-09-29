import type {
  AppSiteResponse,
  AppSiteUpdatePayload,
} from '@dify/contracts/api/console/apps/types.gen'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { useAccessPointActions } from '../shared/use-access-point-actions'

const mocks = vi.hoisted(() => ({
  fetchAppDetail: vi.fn(),
  setAppDetail: vi.fn(),
  toast: vi.fn(),
  updateAppSiteConfig: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({ toast: mocks.toast }))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppDetail: typeof mocks.setAppDetail }) => unknown) =>
    selector({ setAppDetail: mocks.setAppDetail }),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: { byAppId: { get: mocks.fetchAppDetail, site: { post: mocks.updateAppSiteConfig } } },
  },
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
      },
    },
  },
}))

const siteConfig = {
  chat_color_theme: '#000000',
  chat_color_theme_inverted: false,
  copyright: '',
  custom_disclaimer: '',
  default_language: 'en-US',
  description: 'Description',
  icon: '🤖',
  icon_type: 'emoji',
  input_placeholder: '',
  privacy_policy: '',
  prompt_public: false,
  show_workflow_steps: false,
  title: 'App',
  use_icon_as_answer_icon: false,
} satisfies AppSiteUpdatePayload

function renderActions(appId = 'app-1', canManageAccessPoint = true) {
  const queryClient = createTestQueryClient()
  const rendered = renderHook(() => useAccessPointActions(appId, canManageAccessPoint), {
    wrapper: createQueryClientWrapper(queryClient),
  })

  return { ...rendered, queryClient }
}

describe('useAccessPointActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchAppDetail.mockResolvedValue(createAppDetailFixture())
    mocks.updateAppSiteConfig.mockResolvedValue({
      app_id: 'app-1',
      customize_token_strategy: 'not_allow',
      default_language: 'en-US',
      prompt_public: false,
      show_workflow_steps: false,
      title: 'Updated site',
      use_icon_as_answer_icon: false,
    } satisfies AppSiteResponse)
  })

  it('refreshes after a successful access point result', async () => {
    const { result } = renderActions()

    act(() => result.current.handleResult(null))

    await waitFor(() => {
      expect(mocks.fetchAppDetail).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
      expect(mocks.setAppDetail).toHaveBeenCalledWith(createAppDetailFixture())
    })
    expect(mocks.toast).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully', {
      type: 'success',
    })
  })

  it('reports a failed result without refreshing stale state', () => {
    const { result } = renderActions()

    act(() => result.current.handleResult(new Error('request failed')))

    expect(mocks.fetchAppDetail).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully', {
      type: 'error',
    })
  })

  it('invalidates app detail and lists after saving site configuration', async () => {
    const { queryClient, result } = renderActions()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.saveSiteConfig(siteConfig)
    })

    expect(mocks.updateAppSiteConfig).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      body: siteConfig,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-detail', 'app-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['apps'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['apps', 'starred'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['apps', 'recent'] })
    await waitFor(() => expect(mocks.setAppDetail).toHaveBeenCalledWith(createAppDetailFixture()))
  })

  it('keeps site configuration behind Access Point management permission', async () => {
    const { result } = renderActions('app-1', false)

    await act(async () => {
      await result.current.saveSiteConfig(siteConfig)
    })

    expect(mocks.updateAppSiteConfig).not.toHaveBeenCalled()
  })
})
