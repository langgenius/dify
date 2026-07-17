import type { PluginDetail } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EndpointList from '../endpoint-list'

const mockRequest = vi.hoisted(() => vi.fn())
const mockInvalidateInstalledPluginList = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return { ...actual, request: mockRequest }
})

vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

vi.mock('../endpoint-card', () => ({
  default: ({ data }: { data: { name: string } }) => <div>{data.name}</div>,
}))

const submittedState = { name: 'New Endpoint', api_key: 'secret' }

vi.mock('../endpoint-modal', () => ({
  default: ({
    onCancel,
    onSaved,
  }: {
    onCancel: () => void
    onSaved: (value: typeof submittedState) => void
  }) => (
    <div role="dialog" aria-label="endpoint form">
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" onClick={() => onSaved(submittedState)}>
        Save
      </button>
    </div>
  ),
}))

const createPluginDetail = (): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    endpoint: { settings: [], endpoints: [] },
  } as unknown as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-uid',
  source: 'marketplace' as PluginDetail['source'],
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
})

const endpoint = {
  id: 'ep-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  settings: {},
  tenant_id: 'tenant-1',
  plugin_id: 'test-plugin',
  expired_at: '',
  declaration: { settings: [], endpoints: [] },
  name: 'Endpoint 1',
  enabled: true,
  url: 'https://api.example.com',
  hook_id: 'hook-1',
}

const renderEndpointList = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <EndpointList detail={createPluginDetail()} />
    </QueryClientProvider>,
  )
}

describe('EndpointList', () => {
  let endpoints = [endpoint]
  const requests: Array<{ body?: unknown; method: string; url: string }> = []

  beforeEach(() => {
    vi.clearAllMocks()
    endpoints = [endpoint]
    requests.length = 0
    mockRequest.mockImplementation(
      async (url: string, _init: RequestInit, options: { request: Request }) => {
        const method = options.request.method
        const body = method === 'GET' ? undefined : await options.request.clone().json()
        requests.push({ body, method, url })

        if (method === 'GET') {
          return new Response(JSON.stringify({ endpoints }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (method === 'POST') {
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error(`Unexpected request: ${method} ${url}`)
      },
    )
  })

  it('renders endpoints returned by the generated list query', async () => {
    renderEndpointList()

    expect(await screen.findByText('Endpoint 1')).toBeInTheDocument()
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: expect.stringContaining('/workspaces/current/endpoints/list/plugin'),
    })
  })

  it('shows the empty state when the plugin has no endpoints', async () => {
    endpoints = []
    renderEndpointList()

    expect(await screen.findByText('plugin.detailPanel.endpointsEmpty')).toBeInTheDocument()
  })

  it('creates an endpoint through the canonical API and refreshes the list', async () => {
    const user = userEvent.setup()
    renderEndpointList()
    await screen.findByText('Endpoint 1')

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.endpointModalTitle' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'POST',
        url: expect.stringMatching(/\/workspaces\/current\/endpoints$/),
        body: {
          plugin_unique_identifier: 'test-uid',
          name: 'New Endpoint',
          settings: { api_key: 'secret' },
        },
      })
    })
    expect(submittedState).toEqual({ name: 'New Endpoint', api_key: 'secret' })
    expect(mockInvalidateInstalledPluginList).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'endpoint form' })).not.toBeInTheDocument()
  })
})
