import type { ConsoleClient } from '@/service/console'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExternalMetadataSection from '../external-metadata-section'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), remove: vi.fn() }))
vi.mock('@/service/console', async () => {
  const { createConsoleQuery } = await import('@/service/console/query-policies')
  const client = {
    datasets: {
      get: vi.fn(),
      byDatasetId: {
        get: vi.fn(),
        documents: { get: vi.fn(), byDocumentId: { get: vi.fn() } },
        metadata: {
          get: api.get,
          post: api.post,
          byMetadataId: { patch: api.patch, delete: api.remove },
        },
      },
    },
  }
  return { consoleQuery: createConsoleQuery(client as unknown as ConsoleClient) }
})

const setup = (readonly = false) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ExternalMetadataSection datasetId="dataset-a" readonly={readonly} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ doc_metadata: [], built_in_field_enabled: false })
  api.post.mockReset().mockResolvedValue({ id: 'field-a', name: 'score', type: 'number' })
  api.patch.mockReset().mockResolvedValue({ id: 'field-a', name: 'rating', type: 'number' })
  api.remove.mockReset().mockResolvedValue(undefined)
})

describe('External field settings', () => {
  it('saves names and types, then reads the persisted fields again', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(await screen.findByLabelText('dataset.metadata.createMetadata.name'), 'score')
    await user.selectOptions(
      screen.getByLabelText('dataset.metadata.createMetadata.type'),
      'number',
    )
    api.get.mockResolvedValue({
      doc_metadata: [{ id: 'field-a', name: 'score', type: 'number', count: 0 }],
      built_in_field_enabled: false,
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await screen.findByText('score (number)')
    expect(api.post).toHaveBeenCalledWith(
      { params: { dataset_id: 'dataset-a' }, body: { name: 'score', type: 'number' } },
      expect.anything(),
    )
    expect(api.get.mock.calls.length).toBeGreaterThan(1)
    await waitFor(() =>
      expect(screen.getByLabelText('dataset.metadata.createMetadata.name')).toHaveValue(''),
    )
  })

  it('keeps the draft when a save fails and permits retry', async () => {
    const user = userEvent.setup()
    api.post.mockRejectedValueOnce(new Error('API unavailable'))
    setup()
    await user.type(await screen.findByLabelText('dataset.metadata.createMetadata.name'), 'score')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable')
    expect(screen.getByLabelText('dataset.metadata.createMetadata.name')).toHaveValue('score')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  })

  it('renames without changing the type and confirms removal', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({
      doc_metadata: [{ id: 'field-a', name: 'score', type: 'number', count: 0 }],
      built_in_field_enabled: false,
    })
    setup()
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    const input = screen.getByLabelText('dataset.metadata.createMetadata.name')
    await user.clear(input)
    await user.type(input, 'rating')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0]?.[0]).toEqual({
      params: { dataset_id: 'dataset-a', metadata_id: 'field-a' },
      body: { name: 'rating' },
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(api.remove).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalled())
  })

  it('shows saved fields to readers without write actions', async () => {
    api.get.mockResolvedValue({
      doc_metadata: [{ id: 'field-a', name: 'score', type: 'number', count: 0 }],
      built_in_field_enabled: false,
    })
    setup(true)
    await screen.findByText('score (number)')
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
  })
})
