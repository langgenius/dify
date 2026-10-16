import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isEqual } from 'es-toolkit/compat'
import * as React from 'react'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetInfo from '..'
import Dropdown from '../dropdown'

let mockDataset: DatasetDetailWithPartialMembersResponse
const mockPush = vi.fn()
const mockReplace = vi.fn()
const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
const datasetListKey = consoleQuery.datasets.get.key()
const mockExportPipeline = vi.fn()
const mockCheckIsUsedInApp = vi.fn()
const mockDeleteDataset = vi.fn()
let mockIsRbacEnabled = true
const mockConsoleState = vi.hoisted(() => ({
  current: {
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [] as string[],
  },
}))

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })

const createDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => ({
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
  indexing_technique:
    'high_quality' as DatasetDetailWithPartialMembersResponse['indexing_technique'],
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

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset?: DatasetDetailWithPartialMembersResponse }) => unknown,
  ) => selector({ dataset: mockDataset }),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'rag.pipelines.byPipelineId.exports.get': () => ({
      mutateAsync: mockExportPipeline,
    }),
  })
})

vi.mock('@/service/datasets', () => ({
  checkIsUsedInApp: (...args: unknown[]) => mockCheckIsUsedInApp(...args),
  deleteDataset: (...args: unknown[]) => mockDeleteDataset(...args),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'indexing-technique',
  }),
}))

vi.mock('@/app/components/datasets/rename-modal', () => ({
  default: ({
    show,
    onClose,
    onSuccess,
  }: {
    show: boolean
    onClose: () => void
    onSuccess?: () => void
  }) => {
    if (!show) return null
    return (
      <div data-testid="rename-modal">
        <button type="button" onClick={onSuccess}>
          Success
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    )
  },
}))

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole('button')
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
      expect(screen.getByText('indexing-technique')).toBeInTheDocument()
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

describe('Dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset({ pipeline_id: 'pipeline-1', runtime_mode: 'rag_pipeline' })
    mockIsRbacEnabled = true
    mockExportPipeline.mockResolvedValue({ data: 'pipeline-content' })
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue({})
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
      render(<Dropdown expand />)

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
      render(<Dropdown expand />)

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
      render(<Dropdown expand />)

      // Act
      await openMenu(user)

      // Assert
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      expect(screen.queryByText('navigation.settings.resourceAccess')).not.toBeInTheDocument()
    })
  })

  // User interactions that trigger modals and exports.
  describe('Interactions', () => {
    it('should open rename modal when edit is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.edit'))

      // Assert
      expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
    })

    it('should export pipeline when export is clicked', async () => {
      const user = userEvent.setup()
      const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL')
      // Arrange
      render(<Dropdown expand />)

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
      expect(anchorClickSpy).toHaveBeenCalledTimes(1)
    })

    it('should show delete confirmation when delete is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.delete'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('dataset.deleteDatasetConfirmContent')).toBeInTheDocument()
      })
    })

    it('should delete dataset and redirect when confirm is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.delete'))
      await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))

      // Assert
      await waitFor(() => {
        expect(mockDeleteDataset).toHaveBeenCalledWith('dataset-1')
      })
      expect(
        invalidateQueries.mock.calls.filter(([filters]) =>
          isEqual(filters, { queryKey: datasetListKey }),
        ),
      ).toHaveLength(1)
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })

    it('should navigate to dataset access config when resource access is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      mockDataset = createDataset({
        runtime_mode: 'general',
        permission_keys: [DatasetACLPermission.AccessConfig],
      })
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('navigation.settings.resourceAccess'))

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/access-config')
    })
  })
})
