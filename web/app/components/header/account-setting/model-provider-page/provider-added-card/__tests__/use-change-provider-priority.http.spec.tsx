import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { PreferredProviderTypeEnum } from '../../declarations'
import { useChangeProviderPriority } from '../use-change-provider-priority'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('../../hooks', () => ({
  useUpdateModelList: () => vi.fn(),
  useUpdateModelProviders: () => vi.fn(),
}))

const provider: ModelProviderSummaryResponse = {
  provider: 'langgenius/openai/openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  configurate_methods: [],
  supported_model_types: [],
  is_configured: true,
  preferred_provider_type: 'custom',
  custom_configuration: {
    available_credentials: [],
    current_credential_usable: true,
    has_custom_models: false,
    status: 'active',
  },
  system_configuration: { enabled: true },
}

const clients: QueryClient[] = []
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.unstubAllGlobals()
})

function renderPriority() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  clients.push(client)
  return {
    client,
    ...renderHook(() => useChangeProviderPriority(provider), {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  }
}

it.each([
  [
    () => Response.json({ code: 'forbidden', message: 'Permission denied' }, { status: 403 }),
    'Permission denied',
  ],
  [() => new Response('<html>Bad gateway</html>', { status: 502 }), 'HTTP 502'],
  [() => new Response(null, { status: 503 }), 'HTTP 503'],
])(
  'shows exactly one business-hook notification for an HTTP failure',
  async (response, message) => {
    const network = vi.fn<typeof fetch>().mockImplementation(async () => response())
    vi.stubGlobal('fetch', network)
    const { client, result } = renderPriority()

    act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.system))

    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'))
    expect(network).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
    expect(result.current.isChangingPriority).toBe(false)
  },
)

it('reports network failure once from the business hook', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  const { client, result } = renderPriority()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.system))
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'))
  expect(toast.error).toHaveBeenCalledOnce()
})

it('does not report an aborted request as an action failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')))
  const { client, result } = renderPriority()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.system))
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'))
  expect(toast.error).not.toHaveBeenCalled()
})
