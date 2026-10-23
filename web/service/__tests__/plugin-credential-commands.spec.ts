import type { PluginPayload } from '@/app/components/plugins/plugin-auth/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import {
  useAddPluginCredential,
  useDeletePluginCredential,
  useDeletePluginOAuthCustomClient,
  useGetPluginOAuthUrl,
  useSetPluginDefaultCredential,
  useSetPluginOAuthCustomClient,
  useUpdatePluginCredential,
} from '../use-plugins-auth'

const request = vi.hoisted(() => vi.fn<typeof import('../base').request>())
vi.mock('@/service/base', () => ({ request }))

const categories = [
  {
    category: AuthCategory.tool,
    path: '/workspaces/current/tool-provider/builtin/owner',
    defaultPath: 'default-credential',
    keys: (provider: string) => [
      consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key({
        input: { params: { provider } },
      }),
      consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key({
        input: { params: { provider } },
      }),
    ],
  },
  {
    category: AuthCategory.datasource,
    path: '/auth/plugin/datasource/owner',
    defaultPath: 'default',
    keys: (provider: string) => [
      consoleQuery.auth.plugin.datasource.byProviderId.get.key({
        input: { params: { provider_id: provider } },
      }),
    ],
  },
]

afterEach(() => {
  request.mockReset()
  vi.restoreAllMocks()
})

it.each(categories)(
  'routes $category credential commands and refreshes only that provider',
  async ({ category, path, defaultPath, keys }) => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    const { result, unmount } = renderHook(
      () => ({
        remove: useDeletePluginCredential({ category, provider: 'owner' }),
        setDefault: useSetPluginDefaultCredential({ category, provider: 'owner' }),
      }),
      { wrapper },
    )
    try {
      for (const operation of ['default', 'delete'] as const) {
        const affected = keys('owner')
        const unrelated = keys('other')
        for (const key of [...affected, ...unrelated])
          queryClient.setQueryData(key, { cached: true })
        request.mockReset().mockResolvedValue(Response.json({ result: 'success' }))
        await act(async () => {
          if (operation === 'default') await result.current.setDefault.mutateAsync('credential-1')
          else await result.current.remove.mutateAsync({ credential_id: 'credential-1' })
        })
        const [url, , options] = request.mock.calls[0]!
        expect(new URL(url).pathname).toBe(
          `/console/api${path}/${operation === 'default' ? defaultPath : 'delete'}`,
        )
        expect(options?.request?.method).toBe('POST')
        expect(await options?.request?.json()).toEqual(
          operation === 'default' ? { id: 'credential-1' } : { credential_id: 'credential-1' },
        )
        for (const key of affected) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        for (const key of unrelated)
          expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
      }
    } finally {
      unmount()
      queryClient.clear()
    }
  },
)

it.each(categories)(
  'preserves $category cached credentials when the mutation fails',
  async ({ category, keys }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    const affected = keys('owner')
    for (const key of affected) queryClient.setQueryData(key, { cached: true })
    request.mockRejectedValue(new Error('Request rejected'))
    const { result, unmount } = renderHook(
      () => useDeletePluginCredential({ category, provider: 'owner' }),
      { wrapper },
    )
    try {
      await act(async () => {
        await expect(result.current.mutateAsync({ credential_id: 'credential-1' })).rejects.toThrow(
          'Request rejected',
        )
      })
      for (const key of affected) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
    } finally {
      unmount()
      queryClient.clear()
    }
  },
)

it.each([
  { category: AuthCategory.model, provider: 'owner' },
  { category: AuthCategory.trigger, provider: 'owner' },
  { category: AuthCategory.tool, provider: '' },
] satisfies PluginPayload[])(
  'does not send unsupported credential commands ($category, $provider)',
  async (payload) => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    const { result, unmount } = renderHook(
      () => ({
        remove: useDeletePluginCredential(payload),
        setDefault: useSetPluginDefaultCredential(payload),
      }),
      { wrapper },
    )
    try {
      await expect(
        result.current.remove.mutateAsync({ credential_id: 'credential-1' }),
      ).rejects.toThrow()
      await expect(result.current.setDefault.mutateAsync('credential-1')).rejects.toThrow()
      expect(request).not.toHaveBeenCalled()
    } finally {
      unmount()
      queryClient.clear()
    }
  },
)

it.each(categories)(
  'saves and removes $category OAuth client configuration',
  async ({ category, path, keys }) => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    const oauthKeys = (provider: string) =>
      category === AuthCategory.tool
        ? [
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.key(
              { input: { params: { provider } } },
            ),
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.customClient.get.key(
              { input: { params: { provider } } },
            ),
          ]
        : keys(provider)
    const { result, unmount } = renderHook(
      () => ({
        save: useSetPluginOAuthCustomClient({ category, provider: 'owner' }),
        remove: useDeletePluginOAuthCustomClient({ category, provider: 'owner' }),
      }),
      { wrapper },
    )
    try {
      for (const operation of ['save', 'delete'] as const) {
        const affected = oauthKeys('owner')
        const unrelated = oauthKeys('other')
        for (const key of [...affected, ...unrelated])
          queryClient.setQueryData(key, { cached: true })
        request.mockReset().mockResolvedValue(Response.json({ result: 'success' }))
        const body = {
          client_params: { client_id: 'test-client' },
          enable_oauth_custom_client: false,
        }
        await act(async () => {
          if (operation === 'save') await result.current.save.mutateAsync(body)
          else await result.current.remove.mutateAsync()
        })
        const [url, , options] = request.mock.calls[0]!
        expect(new URL(url).pathname).toBe(
          `/console/api${path}/${category === AuthCategory.tool ? 'oauth/' : ''}custom-client`,
        )
        expect(options?.request?.method).toBe(operation === 'save' ? 'POST' : 'DELETE')
        if (operation === 'save') expect(await options?.request?.json()).toEqual(body)
        else expect(await options?.request?.text()).toBe('')
        for (const key of affected) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        for (const key of unrelated)
          expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
      }
    } finally {
      unmount()
      queryClient.clear()
    }
  },
)

it.each(categories)(
  'adds and renames $category credentials with generated payloads',
  async ({ category, path, keys }) => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    const { result, unmount } = renderHook(
      () => ({
        add: useAddPluginCredential({ category, provider: 'owner' }),
        update: useUpdatePluginCredential({ category, provider: 'owner' }),
      }),
      { wrapper },
    )
    try {
      for (const operation of ['add', 'update'] as const) {
        for (const key of [...keys('owner'), ...keys('other')])
          queryClient.setQueryData(key, { cached: true })
        request.mockReset().mockResolvedValue(
          Response.json(
            { result: 'success' },
            {
              status: category === AuthCategory.datasource && operation === 'update' ? 201 : 200,
            },
          ),
        )
        await act(async () => {
          if (operation === 'add')
            await result.current.add.mutateAsync({
              type: 'api-key',
              credentials: { api_key: 'test-key' },
              name: 'New credential',
              visibility: 'only_me',
            })
          else
            await result.current.update.mutateAsync({
              credential_id: 'credential-1',
              name: 'Renamed',
            })
        })
        const [url, , options] = request.mock.calls[0]!
        expect(new URL(url).pathname).toBe(
          `/console/api${path}${operation === 'add' && category === AuthCategory.datasource ? '' : `/${operation}`}`,
        )
        const body = await options?.request?.json()
        if (operation === 'update')
          expect(body).toEqual({ credential_id: 'credential-1', name: 'Renamed' })
        else
          expect(body).toEqual({
            credentials: { api_key: 'test-key' },
            name: 'New credential',
            ...(category === AuthCategory.tool ? { type: 'api-key', visibility: 'only_me' } : {}),
          })
        for (const key of keys('owner'))
          expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        for (const key of keys('other'))
          expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
      }
    } finally {
      unmount()
      queryClient.clear()
    }
  },
)

it.each(categories)(
  'requests a fresh $category OAuth URL with the selected visibility',
  async ({ category }) => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    const { result, unmount } = renderHook(
      () => useGetPluginOAuthUrl({ category, provider: 'owner' }),
      { wrapper },
    )
    try {
      for (const visibility of ['only_me', 'all_team_members'] as const) {
        request.mockResolvedValueOnce(
          Response.json({ authorization_url: `https://example.com/oauth/${visibility}` }),
        )
        await act(async () => {
          await expect(result.current.mutateAsync({ visibility })).resolves.toMatchObject({
            authorization_url: `https://example.com/oauth/${visibility}`,
          })
        })
      }
      expect(request).toHaveBeenCalledTimes(2)
      for (const [index, [url, , options]] of request.mock.calls.entries()) {
        const target = new URL(url)
        expect(target.pathname).toBe(
          `/console/api/oauth/plugin/owner/${category === AuthCategory.tool ? 'tool/authorization-url' : 'datasource/get-authorization-url'}`,
        )
        expect(target.searchParams.get('visibility')).toBe(
          index === 0 ? 'only_me' : 'all_team_members',
        )
        expect(options?.request?.method).toBe('GET')
      }
      await waitFor(() => expect(result.current.isPending).toBe(false))
    } finally {
      unmount()
      queryClient.clear()
    }
  },
)
