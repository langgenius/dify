import type {
  AppDetailWithSite,
  AppSiteUpdatePayload,
} from '@dify/contracts/api/console/apps/types.gen'
import { useQuery } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderHookWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { useAccessPointActions } from '../shared/use-access-point-actions'

const mocks = vi.hoisted(() => ({ updateSite: vi.fn(), success: vi.fn(), error: vi.fn() }))
let serverAppDetail: AppDetailWithSite
vi.mock('@/app/notifications', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: async (url: string, _init: RequestInit, { request }: { request: Request }) => {
    if (request.method === 'GET') return Response.json(serverAppDetail)
    if (request.method === 'POST' && new URL(url).pathname.endsWith('/site')) {
      const body = await request.json()
      await mocks.updateSite(url, body)
      serverAppDetail = { ...serverAppDetail, site: createAppSiteFixture(body) }
      return Response.json(serverAppDetail.site)
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`)
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

function renderActions(canManageAccessPoint = true) {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, serverAppDetail)
  const otherApp = seedAppDetail(queryClient, { id: 'app-2', name: 'Other app' })
  const rendered = renderHookWithConsoleQuery(
    ({ appId }: { appId: string }) => ({
      ...useAccessPointActions(appId, canManageAccessPoint),
      detail: useQuery(
        consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
      ).data,
    }),
    { queryClient, initialProps: { appId: 'app-1' } },
  )
  return { ...rendered, otherApp }
}

describe('useAccessPointActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverAppDetail = createAppDetailFixture({
      id: 'app-1',
      site: createAppSiteFixture({ title: 'Before' }),
    })
    mocks.updateSite.mockResolvedValue(undefined)
  })

  it('refreshes the shared app detail after saving site configuration', async () => {
    const { result } = renderActions()
    await act(async () => {
      await result.current.saveSiteConfig(siteConfig)
    })
    expect(mocks.updateSite).toHaveBeenCalledWith(
      expect.stringContaining('/apps/app-1/site'),
      siteConfig,
    )
    await waitFor(() => expect(result.current.detail?.site?.title).toBe('App'))
    expect(mocks.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
  })

  it('retains the previous detail when saving fails', async () => {
    mocks.updateSite.mockRejectedValue(new Error('request failed'))
    const { result } = renderActions()
    await act(async () => {
      await result.current.saveSiteConfig(siteConfig)
    })
    expect(result.current.detail?.site?.title).toBe('Before')
    expect(mocks.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
  })

  it('keeps site configuration behind Access Point management permission', async () => {
    const { result } = renderActions(false)
    await act(async () => {
      await result.current.saveSiteConfig(siteConfig)
    })
    expect(mocks.updateSite).not.toHaveBeenCalled()
  })

  it('keeps a late site save scoped to its submitted app after the active app changes', async () => {
    let resolveSave!: () => void
    mocks.updateSite.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve
      }),
    )
    const { result, rerender, queryClient, otherApp } = renderActions()
    let saving!: Promise<void>
    act(() => {
      saving = result.current.saveSiteConfig(siteConfig)
    })
    await waitFor(() => expect(mocks.updateSite).toHaveBeenCalledOnce())
    rerender({ appId: 'app-2' })
    await act(async () => {
      resolveSave()
      await saving
    })
    expect(result.current.detail).toEqual(otherApp)
    expect(
      queryClient.getQueryData(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-2' } } }),
      ),
    ).toEqual(otherApp)
  })
})
