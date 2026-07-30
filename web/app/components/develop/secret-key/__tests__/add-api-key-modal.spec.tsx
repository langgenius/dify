import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import AddApiKeyModal from '../add-api-key-modal'

const mockCreateDatasetApikey = vi.fn().mockResolvedValue({
  id: 'new-key',
  token: 'ds-vd...cdef',
  created_at: '1700000000',
})
const mockInvalidateDatasetApiKeys = vi.fn()

vi.mock('@/service/datasets', () => ({
  createApikey: (...args: unknown[]) => mockCreateDatasetApikey(...args),
}))

const mockUseInfiniteDatasets = vi.fn()
vi.mock('@/service/knowledge/use-dataset', () => ({
  useInfiniteDatasets: (...args: unknown[]) => mockUseInfiniteDatasets(...args),
  useInvalidateDatasetApiKeys: () => mockInvalidateDatasetApiKeys,
}))

vi.mock('../secret-key-generate', () => ({
  default: ({ isShow }: { isShow: boolean }) => (isShow ? <div>generated key modal</div> : null),
}))

describe('AddApiKeyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInfiniteDatasets.mockReturnValue({
      data: { pages: [{ data: [{ id: 'kb-1', name: 'KB One' }, { id: 'kb-2', name: 'KB Two' }] }] },
    })
  })

  it('defaults to the "all knowledge bases" scope', async () => {
    render(<AddApiKeyModal isShow onClose={vi.fn()} />)

    expect(screen.getByText('appApi.apiKeyModal.addTitle')).toBeInTheDocument()
    // The specific-scope select area is hidden until "Specific" is chosen.
    expect(screen.queryByText('appApi.apiKeyModal.noKnowledgeBasesSelected')).not.toBeInTheDocument()
  })

  it('creates an unscoped key with an empty dataset_ids list', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AddApiKeyModal isShow onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(mockCreateDatasetApikey).toHaveBeenCalledWith({
        url: '/datasets/api-keys',
        body: { dataset_ids: [] },
      })
    })
    expect(mockInvalidateDatasetApiKeys).toHaveBeenCalled()
  })

  it('reveals the select area and blocks creation until a knowledge base is chosen', async () => {
    const user = userEvent.setup()
    render(<AddApiKeyModal isShow onClose={vi.fn()} />)

    await user.click(screen.getByText('appApi.apiKeyModal.scopeSpecificDatasets'))

    expect(screen.getByText('appApi.apiKeyModal.noKnowledgeBasesSelected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
  })

  it('creates a scoped key with the selected knowledge base ids', async () => {
    const user = userEvent.setup()
    render(<AddApiKeyModal isShow onClose={vi.fn()} />)

    await user.click(screen.getByText('appApi.apiKeyModal.scopeSpecificDatasets'))
    await user.click(screen.getByRole('button', { name: /appApi.apiKeyModal.addKnowledgeBase/ }))
    await user.click(screen.getByText('KB One'))

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(mockCreateDatasetApikey).toHaveBeenCalledWith({
        url: '/datasets/api-keys',
        body: { dataset_ids: ['kb-1'] },
      })
    })
  })
})
