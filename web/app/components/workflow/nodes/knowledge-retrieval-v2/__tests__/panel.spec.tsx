import type { KnowledgeRetrievalV2NodeType } from '../types'
import type useConfig from '../use-config'
import type { PanelProps } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import Panel from '../panel'

const service = vi.hoisted(() => ({
  listMetadata: vi.fn(),
  listSpaces: vi.fn(),
}))
const configState = vi.hoisted(() => ({
  handleSpacesChange: vi.fn(),
  handleTopNChange: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'knowledgeFs.spaces.byControlSpaceId.metadata.get': service.listMetadata,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.get': service.listSpaces,
    }),
  }
})

// Node configuration editing has its own hook suite; this panel suite renders a given config.
const useConfigMock = vi.hoisted(() => vi.fn())
vi.mock('../use-config', () => ({ default: useConfigMock }))
// These children have their own interaction suites and only receive panel-owned values.
vi.mock('../components/add-knowledge-space', () => ({ default: () => null }))
vi.mock('../components/recall-settings', () => ({
  default: ({ onTopKChange, topK }: { onTopKChange: (value: number) => void; topK: number }) => (
    <button type="button" onClick={() => onTopKChange(12)}>
      recall top {topK}
    </button>
  ),
}))
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => null,
}))
vi.mock(
  '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter',
  () => ({
    default: (props: {
      metadataFilterMode: string
      metadataList: Array<{ name: string; type: string }>
      selectedDatasetsLoaded: boolean
    }) => (
      <section aria-label="metadata filter">
        <p>mode: {props.metadataFilterMode}</p>
        <p>loaded: {String(props.selectedDatasetsLoaded)}</p>
        <ul>
          {props.metadataList.map((field) => (
            <li key={field.name}>{`${field.name}:${field.type}`}</li>
          ))}
        </ul>
      </section>
    ),
  }),
)

const panelProps: PanelProps = {
  getInputVars: () => [],
  toVarInputs: () => [],
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: undefined,
}

const space = (controlSpaceId: string, name: string, technicalStatus = 'available') => ({
  control_space_id: controlSpaceId,
  created_at: '2026-08-18T00:00:00Z',
  knowledge_space_id: controlSpaceId,
  linked_apps: 0,
  owner_account_id: 'account-1',
  permission_keys: ['knowledge_space_read', 'knowledge_space_query'],
  resource_version: 1,
  state: 'active',
  technical_status: technicalStatus,
  technical_summary: {
    description: null,
    knowledge_space_id: controlSpaceId,
    name,
    revision: 1,
    slug: controlSpaceId,
  },
  updated_at: '2026-08-18T00:00:00Z',
  visibility: 'only_me',
})

const field = (name: string, type: 'number' | 'string' | 'time') => ({
  count: 1,
  created_at: '2026-08-18T00:00:00Z',
  id: `${name}-${type}`,
  name,
  row_version: 1,
  type,
  updated_at: '2026-08-18T00:00:00Z',
})

const nodeData = (
  overrides: Partial<KnowledgeRetrievalV2NodeType> = {},
): KnowledgeRetrievalV2NodeType => ({
  title: 'Knowledge Retrieval v2',
  desc: '',
  type: BlockEnum.KnowledgeRetrievalV2,
  query_variable_selector: ['start', 'query'],
  control_space_ids: ['space-1'],
  mode: 'research',
  top_n: 10,
  ...overrides,
})

function renderPanel(data = nodeData()) {
  useConfigMock.mockReturnValue({
    readOnly: false,
    inputs: data,
    availableNumberNodesWithParent: [],
    availableNumberVars: [],
    availableStringNodesWithParent: [],
    availableStringVars: [],
    filterFileVar: vi.fn(),
    filterStringVar: vi.fn(),
    handleAddCondition: vi.fn(),
    handleMetadataCompletionParamsChange: vi.fn(),
    handleMetadataFilterChange: vi.fn(),
    handleMetadataFilterModeChange: vi.fn(),
    handleMetadataModelChange: vi.fn(),
    handleModeChange: vi.fn(),
    handleNodeKindToggle: vi.fn(),
    handleQueryAttachmentChange: vi.fn(),
    handleQueryVarChange: vi.fn(),
    handleRerankingModelChange: vi.fn(),
    handleRemoveCondition: vi.fn(),
    handleScoreThresholdChange: vi.fn(),
    handleSpacesChange: configState.handleSpacesChange,
    handleTopNChange: configState.handleTopNChange,
    handleToggleConditionLogicalOperator: vi.fn(),
    handleUpdateCondition: vi.fn(),
  } satisfies Partial<ReturnType<typeof useConfig>>)
  return renderWithConsoleQuery(
    <Panel id="knowledge-retrieval-v2-1" data={data} panelProps={panelProps} />,
  )
}

describe('KnowledgeRetrievalV2Panel', () => {
  beforeEach(() => {
    service.listSpaces.mockReset()
    service.listSpaces.mockResolvedValue({
      data: [space('space-1', 'Product docs'), space('space-2', 'Archived docs', 'unavailable')],
      has_more: false,
      limit: 50,
      page: 1,
    })
    service.listMetadata.mockReset()
    service.listMetadata.mockResolvedValue({
      data: [field('department', 'string')],
      next_cursor: null,
    })
  })

  it('lists the selected spaces by name and routes recall changes to the node config', async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByText('Product docs')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'recall top 10' }))
    expect(configState.handleTopNChange).toHaveBeenCalledWith(12)
  })

  it('keeps a selected space visible after it becomes unavailable so it can be removed', async () => {
    const user = userEvent.setup()
    renderPanel(nodeData({ control_space_ids: ['space-2'] }))

    expect(await screen.findByText('Archived docs')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(configState.handleSpacesChange).toHaveBeenCalledWith([])
  })

  it('offers only user metadata shared by every selected space with the same type', async () => {
    service.listMetadata.mockImplementation(
      async ({ params }: { params: { control_space_id: string } }) => ({
        data:
          params.control_space_id === 'space-1'
            ? [
                field('department', 'string'),
                field('priority', 'number'),
                field('space_one_only', 'string'),
              ]
            : [field('department', 'string'), field('priority', 'string')],
        next_cursor: null,
      }),
    )
    renderPanel(nodeData({ control_space_ids: ['space-1', 'space-2'] }))

    const filter = screen.getByRole('region', { name: 'metadata filter' })
    await waitFor(() => expect(filter).toHaveTextContent('loaded: true'))
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'department:string',
    ])
  })

  it('does not treat a failed metadata catalog request as a completed empty catalog', async () => {
    service.listMetadata.mockRejectedValue(new Error('metadata unavailable'))
    renderPanel()

    await waitFor(() => expect(service.listMetadata).toHaveBeenCalled())
    await screen.findByText('Product docs')
    expect(screen.getByRole('region', { name: 'metadata filter' })).toHaveTextContent(
      'loaded: false',
    )
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it.each([
    [MetadataFilteringModeEnum.automatic, 'automatic'],
    [undefined, 'disabled'],
  ])('shows the %s metadata filtering mode as %s', async (persistedMode, mode) => {
    renderPanel(nodeData({ metadata_filtering_mode: persistedMode }))

    expect(screen.getByRole('region', { name: 'metadata filter' })).toHaveTextContent(
      `mode: ${mode}`,
    )
  })
})
