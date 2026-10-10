import type {
  AppSiteResponse,
  AppSiteUpdatePayload,
} from '@dify/contracts/api/console/apps/types.gen'
import { useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { useAccessPointActions } from '../shared/use-access-point-actions'

const mocks = vi.hoisted(() => ({
  fetchAppDetail: vi.fn(),
  toast: vi.fn(),
  updateAppSiteConfig: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({ toast: mocks.toast }))

vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return {
    ...actual,
    request: async (url: string, _init: RequestInit, options: { request: Request }) => {
      const appId = /\/apps\/([^/]+)/.exec(url)?.[1]
      if (options.request.method === 'GET')
        return Response.json(await mocks.fetchAppDetail({ params: { app_id: appId } }))
      return Response.json(
        await mocks.updateAppSiteConfig({
          params: { app_id: appId },
          body: await options.request.json(),
        }),
      )
    },
  }
})

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
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: appId } } }),
    createAppDetailFixture({ id: appId }),
  )
  const rendered = renderHook(
    () => {
      useQuery(consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }))
      return useAccessPointActions(appId, canManageAccessPoint)
    },
    {
      wrapper: createQueryClientWrapper(queryClient),
    },
  )

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

  it('refreshes access metadata through the app detail query', async () => {
    const { result, queryClient } = renderActions()

    await act(async () => result.current.refreshAppDetail())

    await waitFor(() => {
      expect(mocks.fetchAppDetail).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
      expect(
        queryClient.getQueryData(
          consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
        ),
      ).toEqual(createAppDetailFixture())
    })
  })

  it('reports a failed save without invalidating app details', async () => {
    mocks.updateAppSiteConfig.mockRejectedValueOnce(new Error('request failed'))
    const { result } = renderActions()
    await act(async () => result.current.saveSiteConfig(siteConfig))
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
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: consoleQuery.apps.get.key() })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.starred.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: consoleQuery.apps.recent.get.key() })
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
        ),
      ).toEqual(createAppDetailFixture()),
    )
  })

  it('keeps site configuration behind Access Point management permission', async () => {
    const { result } = renderActions('app-1', false)

    await act(async () => {
      await result.current.saveSiteConfig(siteConfig)
    })

    expect(mocks.updateAppSiteConfig).not.toHaveBeenCalled()
  })
})
