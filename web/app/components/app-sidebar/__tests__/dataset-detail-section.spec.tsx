import type { DataSet, RelatedAppResponse } from '@/models/datasets'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetDetailSection from '../dataset-detail-section'

let mockPathname = '/datasets/dataset-1/documents'
let mockDataset: DataSet | undefined
let mockRelatedApps: RelatedAppResponse | undefined
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

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetDetail: () => ({ data: mockDataset, refetch: vi.fn() }),
  useDatasetRelatedApps: () => ({ data: mockRelatedApps }),
}))

vi.mock('../dataset-info', () => ({
  default: () => <div>dataset info</div>,
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href, disabled }: { name: string; href: string; disabled?: boolean }) => {
    if (disabled) return <button disabled>{name}</button>

    return <a href={href}>{name}</a>
  },
}))

vi.mock('../../datasets/extra-info', () => ({
  default: () => <div>dataset extra info</div>,
}))

const createDataset = (overrides: Partial<DataSet> = {}): DataSet =>
  ({
    id: 'dataset-1',
    name: 'Camera Technical Spec',
    description: '',
    provider: 'internal',
    icon_info: {
      icon: '📙',
      icon_type: 'emoji',
      icon_background: '#F0F9FF',
      icon_url: '',
    },
    doc_form: 'hierarchical_model',
    indexing_technique: 'high_quality',
    document_count: 120,
    runtime_mode: 'general',
    retrieval_model_dict: {
      search_method: 'semantic_search',
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 5,
      score_threshold_enabled: false,
      score_threshold: 0,
    },
    enable_api: true,
    permission_keys: [DatasetACLPermission.Edit],
    ...overrides,
  }) as DataSet

describe('DatasetDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/datasets/dataset-1/documents'
    mockIsRbacEnabled = true
    mockDataset = createDataset()
    mockRelatedApps = {
      data: [],
      total: 5,
    }
  })

  it('should hide dataset stats and API access when dataset edit permission is missing', () => {
    mockDataset = createDataset({
      permission_keys: [DatasetACLPermission.Readonly],
    })

    render(<DatasetDetailSection expand />)

    expect(screen.queryByText('dataset extra info')).not.toBeInTheDocument()
  })

  it('should render resource access navigation when dataset access config permission is granted', () => {
    mockDataset = createDataset({
      permission_keys: [DatasetACLPermission.AccessConfig],
    })

    render(<DatasetDetailSection expand />)

    expect(
      screen.getByRole('link', { name: 'navigation.settings.resourceAccess' }),
    ).toHaveAttribute('href', '/datasets/dataset-1/access-config')
  })

  it('should hide resource access navigation when dataset access config permission is missing', () => {
    render(<DatasetDetailSection expand />)

    expect(
      screen.queryByRole('link', { name: 'navigation.settings.resourceAccess' }),
    ).not.toBeInTheDocument()
  })

  it('should hide resource access navigation when RBAC is disabled', () => {
    mockIsRbacEnabled = false
    mockDataset = createDataset({
      permission_keys: [DatasetACLPermission.AccessConfig],
    })

    render(<DatasetDetailSection expand />)

    expect(
      screen.queryByRole('link', { name: 'navigation.settings.resourceAccess' }),
    ).not.toBeInTheDocument()
  })

  it('should render hit testing navigation as a link when retrieval recall permission is granted', () => {
    mockDataset = createDataset({
      permission_keys: [DatasetACLPermission.RetrievalRecall],
    })

    render(<DatasetDetailSection expand />)

    expect(screen.getByRole('link', { name: 'common.datasetMenus.hitTesting' })).toHaveAttribute(
      'href',
      '/datasets/dataset-1/hitTesting',
    )
  })

  it('should disable hit testing navigation when retrieval recall permission is missing', () => {
    render(<DatasetDetailSection expand />)

    expect(screen.getByRole('button', { name: 'common.datasetMenus.hitTesting' })).toBeDisabled()
    expect(
      screen.queryByRole('link', { name: 'common.datasetMenus.hitTesting' }),
    ).not.toBeInTheDocument()
  })

  it('should link to the knowledge graph once the dataset has opted into it', () => {
    mockDataset = createDataset({ graph_index_setting: { enabled: true } })

    render(<DatasetDetailSection expand />)

    expect(
      screen.getByRole('link', { name: 'common.datasetMenus.knowledgeGraph' }),
    ).toHaveAttribute('href', '/datasets/dataset-1/graph')
  })

  it.each([
    ['the graph is off', createDataset({ graph_index_setting: { enabled: false } })],
    // External knowledge bases are retrieved elsewhere and never have a graph.
    [
      'the dataset is external',
      createDataset({ provider: 'external', graph_index_setting: { enabled: true } }),
    ],
  ])('should hide the knowledge graph when %s', (_case, dataset) => {
    mockDataset = dataset

    render(<DatasetDetailSection expand />)

    expect(
      screen.queryByRole('link', { name: 'common.datasetMenus.knowledgeGraph' }),
    ).not.toBeInTheDocument()
  })
})
