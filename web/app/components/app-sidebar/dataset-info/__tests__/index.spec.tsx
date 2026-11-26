import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import DatasetDetailContext from '@/context/dataset-detail'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetInfo from '..'
import ActionsMenu from '../actions-menu'

let mockDataset: ReturnType<typeof createDatasetFixture>
const mockPush = vi.fn()
const mockReplace = vi.fn()
const datasetListKey = consoleQuery.datasets.get.queryKey({
  input: { query: { page: 1, limit: 20 } },
})
const datasetDetailKey = consoleQuery.datasets.byDatasetId.get.queryKey({
  input: { params: { dataset_id: 'dataset-1' } },
})
const mockExportPipeline = vi.fn()
const mockCheckIsUsedInApp = vi.fn()
const mockDeleteDataset = vi.fn()
const mockUpdateDataset = vi.fn()
let mockIsRbacEnabled = true
const mockConsoleState = vi.hoisted(() => ({
  current: {
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [] as string[],
  },
}))

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(datasetListKey, {
    data: [mockDataset],
    has_more: false,
    page: 1,
    limit: 20,
    total: 1,
  })
  queryClient.setQueryData(datasetDetailKey, mockDataset)
  return renderWithConsoleQuery(
    <DatasetDetailContext.Provider value={{ dataset: mockDataset }}>
      {ui}
    </DatasetDetailContext.Provider>,
    {
      queryClient,
      systemFeatures: { rbac_enabled: mockIsRbacEnabled },
    },
  )
}

const createDataset = (overrides: Partial<DatasetDetailWithPartialMembersResponse> = {}) =>
  createDatasetFixture({
    ...createDatasetFixture(),
    id: 'dataset-1',
    name: 'Dataset Name',
    icon_info: {
      icon: '📙',
      icon_background: '#FFF4ED',
      icon_type: 'emoji',
      icon_url: '',
    },
    description: 'Dataset description',
    permission: PermissionLevel.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: 'high_quality',
    created_by: 'user-1',
    updated_by: 'user-1',
    updated_at: 1690000000,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 1,
    word_count: 1000,
    provider: 'internal',
    embedding_model: 'text-embedding-3',
    embedding_model_provider: 'openai',
    embedding_available: true,
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 5,
      score_threshold_enabled: false,
      score_threshold: 0,
    },
    tags: [],
    external_knowledge_info: {
      external_knowledge_id: '',
      external_knowledge_api_id: '',
      external_knowledge_api_name: '',
      external_knowledge_api_endpoint: '',
    },
    external_retrieval_model: {
      top_k: 0,
      score_threshold: 0,
      score_threshold_enabled: false,
    },
    built_in_field_enabled: false,
    runtime_mode: 'rag_pipeline',
    enable_api: false,
    is_multimodal: false,
    permission_keys: [
      DatasetACLPermission.Edit,
      DatasetACLPermission.Delete,
      DatasetACLPermission.ImportExportDSL,
    ],
    ...overrides,
  })

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.useCheck.get': (input) => mockCheckIsUsedInApp(input),
      'datasets.byDatasetId.delete': (input) => mockDeleteDataset(input),
      'rag.pipelines.byPipelineId.exports.get': (input) => mockExportPipeline(input),
    }),
  }
})

vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: (...args: unknown[]) => mockUpdateDataset(...args),
}))

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole('button', { name: 'common.operation.more' })
  await user.click(trigger)
}

describe('DatasetInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRbacEnabled = true
    mockDataset = createDataset()
  })

  // Rendering of dataset summary details based on expand and dataset state.
  describe('Rendering', () => {
    it('should show dataset details when expanded', () => {
      // Arrange
      mockDataset = createDataset({ is_published: false })
      render(<DatasetInfo expand />)

      // Assert
      expect(screen.getByText('Dataset Name')).toBeInTheDocument()
      expect(screen.queryByText('Dataset description')).not.toBeInTheDocument()
      expect(screen.getByText('dataset.chunkingMode.general')).toBeInTheDocument()
      expect(screen.getByText(/dataset.indexingTechnique.high_quality/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.more' })).toBeInTheDocument()
    })

    it('should show external tag when provider is external', () => {
      // Arrange
      mockDataset = createDataset({ provider: 'external', is_published: false })
      render(<DatasetInfo expand />)

      // Assert
      expect(screen.getByText('dataset.externalTag')).toBeInTheDocument()
      expect(screen.queryByText('dataset.chunkingMode.general')).not.toBeInTheDocument()
    })

    it('should keep the dataset name available when collapsed and omit detailed fields', () => {
      // Arrange
      render(<DatasetInfo expand={false} />)

      // Assert
      expect(screen.getByText('Dataset Name')).toBeInTheDocument()
      expect(screen.queryByText('Dataset description')).not.toBeInTheDocument()
    })
  })
})

describe('ActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset({ pipeline_id: 'pipeline-1', runtime_mode: 'rag_pipeline' })
    mockIsRbacEnabled = true
    mockExportPipeline.mockResolvedValue({ data: 'pipeline-content' })
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue({})
    mockUpdateDataset.mockResolvedValue({})
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: vi.fn(),
        writable: true,
      })
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: vi.fn(),
        writable: true,
      })
    }
  })

  // Rendering behavior based on dataset ACL permission keys.
  describe('Rendering', () => {
    it('should hide delete option when dataset lacks delete ACL permission', async () => {
      const user = userEvent.setup()
      // Arrange
      mockDataset = createDataset({
        pipeline_id: 'pipeline-1',
        runtime_mode: 'rag_pipeline',
        permission_keys: [DatasetACLPermission.Edit, DatasetACLPermission.ImportExportDSL],
      })
      render(<ActionsMenu expand />)

      // Act
      await openMenu(user)

      // Assert
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should show resource access option when dataset only has access config ACL permission', async () => {
      const user = userEvent.setup()
      // Arrange
      mockDataset = createDataset({
        runtime_mode: 'general',
        permission_keys: [DatasetACLPermission.AccessConfig],
      })
      render(<ActionsMenu expand />)

      // Act
      await openMenu(user)

      // Assert
      expect(screen.getByText('navigation.settings.resourceAccess')).toBeInTheDocument()
      expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should hide resource access option when RBAC is disabled', async () => {
      const user = userEvent.setup()
      // Arrange
      mockIsRbacEnabled = false
      mockDataset = createDataset({
        runtime_mode: 'general',
        permission_keys: [DatasetACLPermission.AccessConfig, DatasetACLPermission.Delete],
      })
      render(<ActionsMenu expand />)

      // Act
      await openMenu(user)

      // Assert
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      expect(screen.queryByText('navigation.settings.resourceAccess')).not.toBeInTheDocument()
    })
  })

  // User interactions that trigger modals and exports.
  describe('Interactions', () => {
    it('renames the dataset and invalidates cached list and detail', async () => {
      const user = userEvent.setup()
      // Arrange
      const { queryClient } = render(<ActionsMenu expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.edit'))

      // Assert
      const input = await screen.findByRole('textbox', { name: 'datasetSettings.form.name' })
      await user.clear(input)
      await user.type(input, 'Renamed Dataset{Enter}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mockUpdateDataset).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({
          name: 'Renamed Dataset',
          description: 'Dataset description',
        }),
      })
      expect(queryClient.getQueryState(datasetListKey)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(datasetDetailKey)?.isInvalidated).toBe(true)
    })

    it('should export pipeline when export is clicked', async () => {
      const user = userEvent.setup()
      const downloads: Array<{ href: string; name: string }> = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloads.push({ href: this.href, name: this.download })
      })
      const createObjectURLSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:pipeline-export')
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')
      // Arrange
      render(<ActionsMenu expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

      // Assert
      await waitFor(() => {
        expect(mockExportPipeline).toHaveBeenCalledWith({
          params: { pipeline_id: 'pipeline-1' },
          query: { include_secret: 'false' },
        })
      })
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      expect(downloads).toEqual([{ href: 'blob:pipeline-export', name: 'Dataset Name.pipeline' }])
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:pipeline-export')
    })

    it('should delete dataset and redirect when confirm is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      const { queryClient } = render(<ActionsMenu expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.delete'))
      await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))

      // Assert
      await waitFor(() => {
        expect(mockDeleteDataset).toHaveBeenCalledWith({ params: { dataset_id: 'dataset-1' } })
      })
      expect(queryClient.getQueryData(datasetListKey)).toMatchObject({ data: [], total: 0 })
      expect(queryClient.getQueryState(datasetListKey)?.isInvalidated).toBe(true)
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })

    it('should navigate to dataset access config when resource access is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      mockDataset = createDataset({
        runtime_mode: 'general',
        permission_keys: [DatasetACLPermission.AccessConfig],
      })
      render(<ActionsMenu expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('navigation.settings.resourceAccess'))

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/access-config')
    })
  })
})

afterEach(() => vi.restoreAllMocks())
