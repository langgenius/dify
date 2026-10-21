import type { CredentialTypeEnum as CredentialType } from '@/app/components/plugins/plugin-auth/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AuthCategory, CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import {
  useGetPluginCredentialSchema,
  useGetPluginOAuthClientSchema,
  useSetPluginOAuthCustomClient,
} from '../use-plugins-auth'

const request = vi.hoisted(() => vi.fn<typeof import('../base').request>())
vi.mock('@/service/base', () => ({ request }))
afterEach(() => {
  request.mockReset()
})

it('adapts nullable form fields without losing false or zero defaults and separates credential types', async () => {
  request.mockImplementation(async () =>
    Response.json([
      {
        type: 'boolean',
        name: 'enabled',
        label: { en_US: 'Enabled', zh_Hans: null },
        default: false,
        help: null,
        options: null,
      },
      {
        type: 'text-input',
        name: 'retries',
        label: null,
        required: true,
        default: 0,
        options: [{ value: 'one', label: { en_US: 'One' } }],
      },
    ]),
  )
  const { queryClient, wrapper } = createConsoleQueryWrapper()
  const initialProps: { credentialType: CredentialType } = {
    credentialType: CredentialTypeEnum.API_KEY,
  }
  const { result, rerender, unmount } = renderHook(
    ({ credentialType }: { credentialType: CredentialType }) =>
      useGetPluginCredentialSchema(
        { category: AuthCategory.tool, provider: 'owner' },
        credentialType,
      ),
    { wrapper, initialProps },
  )
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject([
      {
        name: 'enabled',
        type: 'boolean',
        label: { en_US: 'Enabled', zh_Hans: 'Enabled' },
        default: false,
        required: false,
      },
      {
        name: 'retries',
        label: 'retries',
        default: 0,
        required: true,
        options: [{ value: 'one', label: { en_US: 'One', zh_Hans: 'One' } }],
      },
    ])
    rerender({ credentialType: CredentialTypeEnum.OAUTH2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(request.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/console/api/workspaces/current/tool-provider/builtin/owner/credential/schema/api-key',
      '/console/api/workspaces/current/tool-provider/builtin/owner/credential/schema/oauth2',
    ])
  } finally {
    unmount()
    queryClient.clear()
  }
})

it('defers OAuth schema loading until enabled and refreshes it after saving configuration', async () => {
  let configured = false
  request.mockImplementation(async (_url, _init, options) => {
    if (options?.request?.method === 'POST') {
      configured = true
      return Response.json({ result: 'success' })
    }
    return Response.json({
      schema: [],
      is_oauth_custom_client_enabled: configured,
      is_system_oauth_params_exists: false,
      client_params: null,
      redirect_uri: 'https://example.com/callback',
    })
  })
  const { queryClient, wrapper } = createConsoleQueryWrapper()
  const payload = { category: AuthCategory.tool, provider: 'owner' }
  const { result, rerender, unmount } = renderHook(
    ({ enabled }) => ({
      query: useGetPluginOAuthClientSchema(payload, enabled),
      save: useSetPluginOAuthCustomClient(payload),
    }),
    { wrapper, initialProps: { enabled: false } },
  )
  try {
    expect(request).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    expect(result.current.query.data?.client_params).toBeUndefined()
    expect(result.current.query.data?.is_oauth_custom_client_enabled).toBe(false)
    await act(async () => {
      await result.current.save.mutateAsync({ client_params: {}, enable_oauth_custom_client: true })
    })
    await waitFor(() =>
      expect(result.current.query.data?.is_oauth_custom_client_enabled).toBe(true),
    )
    expect(request).toHaveBeenCalledTimes(3)
  } finally {
    unmount()
    queryClient.clear()
  }
})

it.each([
  { category: AuthCategory.datasource, provider: 'owner' },
  { category: AuthCategory.trigger, provider: 'owner' },
  { category: AuthCategory.tool, provider: '' },
])('does not request unavailable schemas ($category, $provider)', async (payload) => {
  const { queryClient, wrapper } = createConsoleQueryWrapper()
  const { unmount } = renderHook(
    () => {
      useGetPluginCredentialSchema(payload, CredentialTypeEnum.API_KEY)
      useGetPluginOAuthClientSchema(payload)
    },
    { wrapper },
  )
  try {
    expect(request).not.toHaveBeenCalled()
  } finally {
    unmount()
    queryClient.clear()
  }
})
