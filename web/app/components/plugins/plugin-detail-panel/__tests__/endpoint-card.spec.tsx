import type { ComponentProps } from 'react'
import type { PluginDetail } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EndpointCard from '../endpoint-card'

const mockRequest = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return { ...actual, request: mockRequest }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: mockToastError },
}))

vi.mock('@/app/components/tools/utils/to-form-schema', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/components/tools/utils/to-form-schema')>()
  return { ...actual, addDefaultValue: (value: unknown) => value }
})

const submittedState = { name: 'Updated Endpoint', api_key: 'updated-secret' }

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

type EndpointData = ComponentProps<typeof EndpointCard>['data']

const endpoint: EndpointData = {
  id: 'ep-1',
  name: 'Test Endpoint',
  url: 'https://api.example.com',
  enabled: true,
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  settings: {},
  tenant_id: 'tenant-1',
  plugin_id: 'plugin-1',
  expired_at: '',
  hook_id: 'hook-1',
  declaration: {
    settings: [],
    endpoints: [
      { path: '/api/test', method: 'GET', hidden: false },
      { path: '/api/hidden', method: 'POST', hidden: true },
    ],
  },
}

const pluginDetail: PluginDetail = {
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {} as PluginDetail['declaration'],
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
}

const renderEndpointCard = (data: EndpointData = endpoint, handleChange = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return {
    handleChange,
    ...render(
      <QueryClientProvider client={queryClient}>
        <EndpointCard pluginDetail={pluginDetail} data={data} handleChange={handleChange} />
      </QueryClientProvider>,
    ),
  }
}

describe('EndpointCard', () => {
  const requests: Array<{ body?: unknown; method: string; url: string }> = []

  beforeEach(() => {
    vi.clearAllMocks()
    requests.length = 0
    mockRequest.mockImplementation(
      async (url: string, _init: RequestInit, options: { request: Request }) => {
        const method = options.request.method
        const body = method === 'DELETE' ? undefined : await options.request.clone().json()
        requests.push({ body, method, url })
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    )
  })

  it('renders only visible endpoint routes', () => {
    renderEndpointCard()

    expect(screen.getByText('https://api.example.com/api/test')).toBeInTheDocument()
    expect(screen.queryByText('https://api.example.com/api/hidden')).not.toBeInTheDocument()
  })

  it('enables a disabled endpoint through the generated mutation', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    renderEndpointCard({ ...endpoint, enabled: false }, handleChange)

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'POST',
        url: expect.stringContaining('/workspaces/current/endpoints/enable'),
        body: { endpoint_id: 'ep-1' },
      })
      expect(handleChange).toHaveBeenCalled()
    })
  })

  it('disables an endpoint only after confirmation', async () => {
    const user = userEvent.setup()
    renderEndpointCard()

    await user.click(screen.getByRole('switch'))
    expect(requests).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'POST',
        url: expect.stringContaining('/workspaces/current/endpoints/disable'),
        body: { endpoint_id: 'ep-1' },
      })
    })
  })

  it('deletes an endpoint through the canonical DELETE route', async () => {
    const user = userEvent.setup()
    renderEndpointCard()

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'DELETE',
        url: expect.stringMatching(/\/workspaces\/current\/endpoints\/ep-1$/),
        body: undefined,
      })
    })
  })

  it('updates without mutating the form state object', async () => {
    const user = userEvent.setup()
    renderEndpointCard()

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'PATCH',
        url: expect.stringMatching(/\/workspaces\/current\/endpoints\/ep-1$/),
        body: {
          name: 'Updated Endpoint',
          settings: { api_key: 'updated-secret' },
        },
      })
    })
    expect(submittedState).toEqual({ name: 'Updated Endpoint', api_key: 'updated-secret' })
  })

  it('restores the enabled state when disable is cancelled', async () => {
    const user = userEvent.setup()
    renderEndpointCard()

    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    })
    expect(requests).toHaveLength(0)
  })
})
