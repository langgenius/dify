import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import AddApiKeyModal from '../add-api-key-modal'

type MutationCallbacks<TData> = {
  onSuccess?: (data: TData) => void
}

const createDatasetApiKey = vi.fn(
  (_variables: { body: { dataset_ids?: string[] } }, callbacks?: MutationCallbacks<{ token: string }>) =>
    callbacks?.onSuccess?.({ token: 'new-dataset-token' }),
)
const invalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: () => ({ mutate: createDatasetApiKey, isPending: false }),
    useQueryClient: () => ({ invalidateQueries }),
  }
})

const mockUseInfiniteDatasets = vi.fn()
vi.mock('@/service/knowledge/use-dataset', () => ({
  useInfiniteDatasets: (...args: unknown[]) => mockUseInfiniteDatasets(...args),
}))

vi.mock('../secret-key-generate', () => ({
  default: ({ isShow }: { isShow: boolean }) => (isShow ? <div>generated key modal</div> : null),
}))

describe('AddApiKeyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInfiniteDatasets.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              { id: 'kb-1', name: 'KB One' },
              { id: 'kb-2', name: 'KB Two' },
            ],
          },
        ],
      },
    })
  })

  it('defaults to the "all knowledge bases" scope', () => {
    render(<AddApiKeyModal isShow onClose={vi.fn()} />)

    expect(screen.getByText('appApi.apiKeyModal.addTitle')).toBeInTheDocument()
    // The specific-scope select area is hidden until "Specific" is chosen.
    expect(
      screen.queryByText('appApi.apiKeyModal.noKnowledgeBasesSelected'),
    ).not.toBeInTheDocument()
  })

  it('creates an unscoped key with an empty dataset_ids body', async () => {
    const user = userEvent.setup()
    render(<AddApiKeyModal isShow onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(createDatasetApiKey).toHaveBeenCalledWith(
      { body: { dataset_ids: [] } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(invalidateQueries).toHaveBeenCalled()
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

    expect(createDatasetApiKey).toHaveBeenCalledWith(
      { body: { dataset_ids: ['kb-1'] } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })
})
