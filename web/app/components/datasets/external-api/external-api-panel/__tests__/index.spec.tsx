import type { ExternalKnowledgeApiListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createExternalAPI } from '@/service/datasets'
import { renderWithConfigurationModals as render } from '@/test/configuration-modals'
import ExternalAPIPanel from '../index'

const { getApis } = vi.hoisted(() => ({ getApis: vi.fn() }))
vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  createExternalAPI: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.externalKnowledgeApi.get': getApis,
    }),
  }
})

const response: ExternalKnowledgeApiListResponse = {
  data: [
    {
      id: 'api-1',
      tenant_id: 'tenant-1',
      name: 'Product knowledge',
      description: '',
      settings: { endpoint: 'https://knowledge.example.com', api_key: 'key' },
      dataset_bindings: [],
      created_by: 'user-1',
      created_at: '2021-01-01T00:00:00Z',
    },
  ],
  has_more: false,
  limit: 20,
  page: 1,
  total: 1,
}

describe('ExternalAPIPanel', () => {
  beforeEach(() => {
    getApis.mockResolvedValue(response)
    vi.mocked(createExternalAPI).mockResolvedValue(response.data[0]!)
  })

  it('replaces loading with API cards and allows the panel to close', async () => {
    const user = userEvent.setup()
    let resolve!: (value: ExternalKnowledgeApiListResponse) => void
    getApis.mockReturnValue(
      new Promise<ExternalKnowledgeApiListResponse>((done) => {
        resolve = done
      }),
    )
    const onClose = vi.fn()
    render(<ExternalAPIPanel canManageExternalKnowledgeApi onClose={onClose} />)
    expect(screen.getByLabelText('common.loading')).toBeInTheDocument()
    await act(async () => resolve(response))
    expect(await screen.findByText('Product knowledge')).toBeInTheDocument()
    expect(screen.getByText('https://knowledge.example.com')).toBeInTheDocument()
    expect(screen.queryByLabelText('common.loading')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows read-only API cards when management is unavailable', async () => {
    render(<ExternalAPIPanel canManageExternalKnowledgeApi={false} onClose={vi.fn()} />)
    expect(await screen.findByText('Product knowledge')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.createExternalAPI' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common.operation.edit/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /common.operation.delete/ }),
    ).not.toBeInTheDocument()
  })

  it('opens a blank creation form and refreshes the actual list after save', async () => {
    const user = userEvent.setup()
    getApis.mockResolvedValueOnce({ ...response, data: [], total: 0 })
    render(<ExternalAPIPanel canManageExternalKnowledgeApi onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'dataset.createExternalAPI' }))
    const dialog = await screen.findByRole('dialog', { name: 'dataset.createExternalAPI' })
    expect(within(dialog).getByLabelText(/Name/)).toHaveValue('')
    expect(within(dialog).getByLabelText(/API Endpoint/)).toHaveValue('')
    expect(within(dialog).getByLabelText(/API Key/)).toHaveValue('')
    await user.type(within(dialog).getByLabelText(/Name/), 'Product knowledge')
    await user.type(within(dialog).getByLabelText(/API Endpoint/), 'https://knowledge.example.com')
    await user.type(within(dialog).getByLabelText(/API Key/), 'secret-key')
    await user.click(within(dialog).getByRole('button', { name: 'dataset.externalAPIForm.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(createExternalAPI).toHaveBeenCalledWith({
      body: {
        name: 'Product knowledge',
        settings: { endpoint: 'https://knowledge.example.com', api_key: 'secret-key' },
      },
    })
    expect(await screen.findByText('Product knowledge')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /common.operation.edit Product knowledge/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /common.operation.delete Product knowledge/ }),
    ).toBeInTheDocument()
  })
})
