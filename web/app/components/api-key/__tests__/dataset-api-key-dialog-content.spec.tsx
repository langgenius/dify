import type { PrimitiveAtom } from 'jotai'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useHydrateAtoms } from 'jotai/utils'
import { knowledgeFsEnabledAtom } from '@/features/system-features/state'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { DatasetApiKeyDialogContent } from '../dataset-api-key-dialog-content'
import { useDatasetApiKeyMutations } from '../use-dataset-api-key-mutations'

const apiMocks = vi.hoisted(() => ({
  datasetKeys: [] as Array<Record<string, unknown>>,
  knowledgeSpaces: [] as Array<{ control_space_id: string; technical_summary: { name: string } }>,
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
        case 'knowledgeFs.spaces.get':
          return { data: apiMocks.knowledgeSpaces, page: 1, limit: 20, has_more: false }
        default:
          throw new Error(`Unexpected API call: ${path.join('.')}`)
      }
    },
  },
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ currentWorkspace: { id: 'workspace-1' } }))
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (value: number) => `Formatted: ${value}` }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInfiniteDatasets: () => ({ data: { pages: [{ data: [] }] }, isLoading: false }),
}))

// KnowledgeFS spaces only show up in the scope picker when the workspace has KnowledgeFS.
vi.mock('@/features/system-features/state', async () => {
  const actual = await vi.importActual<typeof import('@/features/system-features/state')>(
    '@/features/system-features/state',
  )
  const { atom } = await import('jotai')
  return {
    ...actual,
    knowledgeFsEnabledAtom: atom(false),
  }
})

function DatasetApiKeys() {
  // The mocked atom is primitive so each case can seed it; the Jotai store outlives a single
  // test, so force the hydration instead of keeping the first case's value.
  useHydrateAtoms(
    [[knowledgeFsEnabledAtom as PrimitiveAtom<boolean>, apiMocks.knowledgeFsEnabled]],
    {
      dangerouslyForceHydrate: true,
    },
  )
  const mutations = useDatasetApiKeyMutations()
  return (
    <Dialog open>
      <DatasetApiKeyDialogContent canManage mutations={mutations} />
    </Dialog>
  )
}

function renderDialog() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <DatasetApiKeys />
    </QueryClientProvider>,
  )
}

describe('DatasetApiKeyDialogContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.datasetKeys = []
    apiMocks.knowledgeSpaces = []
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
})
