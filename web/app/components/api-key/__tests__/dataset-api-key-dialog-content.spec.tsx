import { Dialog } from '@langgenius/dify-ui/dialog'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DatasetApiKeyDialogContent } from '../dataset-api-key-dialog-content'
import { useDatasetApiKeyMutations } from '../use-dataset-api-key-mutations'

const apiMocks = vi.hoisted(() => ({
  datasetKeys: [] as Array<Record<string, unknown>>,
  knowledgeSpaces: [] as Array<{ control_space_id: string; technical_summary: { name: string } }>,
  knowledgeSpacePages: null as null | Array<
    Array<{ control_space_id: string; technical_summary: { name: string } }>
  >,
  knowledgeSpacesFailures: 0,
  knowledgeFsEnabled: false,
  createDataset: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: async (path: string[], input: unknown) => {
      switch (path.join('.')) {
        case 'datasets.apiKeys.get':
          return { data: apiMocks.datasetKeys }
        case 'datasets.apiKeys.post':
          apiMocks.createDataset(input)
          return { id: 'new-key', token: 'new-dataset-token-123', type: 'dataset', created_at: 2 }
        case 'datasets.get':
          return { data: [], page: 1, limit: 20, has_more: false, total: 0 }
        case 'knowledgeFs.spaces.get': {
          if (apiMocks.knowledgeSpacesFailures > 0) {
            apiMocks.knowledgeSpacesFailures -= 1
            throw new Error('KnowledgeFS unavailable')
          }
          const page = (input as { query: { page: number } }).query.page
          if (!apiMocks.knowledgeSpacePages)
            return { data: apiMocks.knowledgeSpaces, page, limit: 20, has_more: false }
          return {
            data: apiMocks.knowledgeSpacePages[page - 1] ?? [],
            page,
            limit: 20,
            has_more: page < apiMocks.knowledgeSpacePages.length,
          }
        }
        default:
          throw new Error(`Unexpected API call: ${path.join('.')}`)
      }
    },
  },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (value: number) => `Formatted: ${value}` }),
}))

function DatasetApiKeys() {
  const mutations = useDatasetApiKeyMutations()
  return (
    <Dialog open>
      <DatasetApiKeyDialogContent canManage mutations={mutations} />
    </Dialog>
  )
}

function renderDialog() {
  // KnowledgeFS spaces only show up in the scope picker when the workspace has KnowledgeFS.
  return renderWithConsoleQuery(<DatasetApiKeys />, {
    currentWorkspace: { id: 'workspace-1' },
    knowledgeFsFeatures: { enabled: apiMocks.knowledgeFsEnabled },
  })
}

describe('DatasetApiKeyDialogContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.datasetKeys = []
    apiMocks.knowledgeSpaces = []
    apiMocks.knowledgeSpacePages = null
    apiMocks.knowledgeSpacesFailures = 0
    apiMocks.knowledgeFsEnabled = false
  })

  it('counts KnowledgeFS space bindings in the scope label', async () => {
    apiMocks.datasetKeys = [
      { id: 'all', token: 'dataset-all-token-123456789', type: 'dataset', created_at: 1 },
      {
        id: 'scoped',
        token: 'dataset-scoped-token-987654321',
        type: 'dataset',
        created_at: 1,
        dataset_ids: [],
        knowledge_space_ids: ['space-1'],
      },
    ]
    renderDialog()

    expect(await screen.findByText('appApi.apiKeyModal.scopeAllDatasets')).toBeInTheDocument()
    expect(screen.getByText('appApi.apiKeyModal.scopeCount:{"count":1}')).toBeInTheDocument()
  })

  it('creates an all-access key with empty bindings for both knowledge base kinds', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(
      await screen.findByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    )
    await user.click(await screen.findByRole('button', { name: 'common.operation.create' }))

    await waitFor(() =>
      expect(apiMocks.createDataset).toHaveBeenCalledWith({
        body: { dataset_ids: [], knowledge_space_ids: [] },
      }),
    )
  })

  it('scopes a key to a KnowledgeFS space through knowledge_space_ids', async () => {
    apiMocks.knowledgeFsEnabled = true
    apiMocks.knowledgeSpaces = [
      { control_space_id: 'space-1', technical_summary: { name: 'Space One' } },
    ]
    const user = userEvent.setup()
    renderDialog()

    await user.click(
      await screen.findByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    )
    await user.click(await screen.findByText('appApi.apiKeyModal.scopeSpecificDatasets'))
    await user.click(screen.getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }))
    // KnowledgeFS spaces are listed under their own heading and picked like any dataset.
    expect(
      await screen.findByRole('group', { name: 'appApi.apiKeyModal.pickerKnowledgeSpaces' }),
    ).toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'Space One' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    // The space id travels in knowledge_space_ids, never in the legacy dataset_ids list.
    await waitFor(() =>
      expect(apiMocks.createDataset).toHaveBeenCalledWith({
        body: { dataset_ids: [], knowledge_space_ids: ['space-1'] },
      }),
    )
  })

  it('loads further KnowledgeFS pages so every matching space can be scoped', async () => {
    apiMocks.knowledgeFsEnabled = true
    apiMocks.knowledgeSpacePages = [
      [{ control_space_id: 'space-1', technical_summary: { name: 'Space One' } }],
      [{ control_space_id: 'space-21', technical_summary: { name: 'Space Twenty-One' } }],
    ]
    const user = userEvent.setup()
    renderDialog()

    await user.click(
      await screen.findByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    )
    await user.click(await screen.findByText('appApi.apiKeyModal.scopeSpecificDatasets'))
    await user.click(screen.getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }))
    expect(await screen.findByRole('option', { name: 'Space One' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Space Twenty-One' })).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'appApi.apiKeyModal.loadMoreKnowledgeSpaces' }),
    )
    await user.click(await screen.findByRole('option', { name: 'Space Twenty-One' }))
    expect(
      screen.queryByRole('button', { name: 'appApi.apiKeyModal.loadMoreKnowledgeSpaces' }),
    ).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() =>
      expect(apiMocks.createDataset).toHaveBeenCalledWith({
        body: { dataset_ids: [], knowledge_space_ids: ['space-21'] },
      }),
    )
  })

  it('shows a retryable error instead of an empty result when the KnowledgeFS lookup fails', async () => {
    apiMocks.knowledgeFsEnabled = true
    apiMocks.knowledgeSpacesFailures = 1
    apiMocks.knowledgeSpaces = [
      { control_space_id: 'space-1', technical_summary: { name: 'Space One' } },
    ]
    const user = userEvent.setup()
    renderDialog()

    await user.click(
      await screen.findByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    )
    await user.click(await screen.findByText('appApi.apiKeyModal.scopeSpecificDatasets'))
    await user.click(screen.getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('appApi.apiKeyModal.loadKnowledgeSpacesError')
    expect(screen.queryByText('common.noData')).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))

    expect(await screen.findByRole('option', { name: 'Space One' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
