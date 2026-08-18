import type { ComponentProps, ReactNode } from 'react'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

const mockUseInfiniteQuery = vi.hoisted(() => vi.fn())
const mockUseQueries = vi.hoisted(() => vi.fn())
const mockInfiniteOptions = vi.hoisted(() => vi.fn((options: unknown) => options))
const mockMetadataQueryOptions = vi.hoisted(() => vi.fn((options: unknown) => options))
const mockHandleMetadataFilterChange = vi.hoisted(() => vi.fn())
const mockMetadataFilterProps = vi.hoisted(() => vi.fn())
const mockHandleSpaceToggle = vi.hoisted(() => vi.fn())
const mockHandleTopNChange = vi.hoisted(() => vi.fn())
const mockInputs = vi.hoisted(() => ({
  title: 'Knowledge Retrieval v2',
  desc: '',
  type: 'knowledge-retrieval-v2',
  query_variable_selector: ['start', 'query'],
  control_space_ids: ['space-1'],
  mode: 'research',
  top_n: 10,
}))

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: mockUseInfiniteQuery,
  useQueries: mockUseQueries,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          metadata: { get: { queryOptions: mockMetadataQueryOptions } },
        },
        get: { infiniteOptions: mockInfiniteOptions },
      },
    },
  },
}))

vi.mock('../use-config', () => ({
  default: () => ({
    readOnly: false,
    inputs: mockInputs,
    availableNumberNodesWithParent: [],
    availableNumberVars: [],
    availableStringNodesWithParent: [],
    availableStringVars: [],
    filterStringVar: vi.fn(),
    handleAddCondition: vi.fn(),
    handleMetadataFilterChange: mockHandleMetadataFilterChange,
    handleMetadataFilterModeChange: vi.fn(),
    handleModeChange: vi.fn(),
    handleNodeKindToggle: vi.fn(),
    handleQueryVarChange: vi.fn(),
    handleRemoveCondition: vi.fn(),
    handleSpaceToggle: mockHandleSpaceToggle,
    handleTopNChange: mockHandleTopNChange,
    handleToggleConditionLogicalOperator: vi.fn(),
    handleUpdateCondition: vi.fn(),
  }),
}))

vi.mock(
  '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter',
  () => ({
    default: (props: {
      allowedModes: string[]
      metadataList: Array<{ name: string; type: string }>
      selectedDatasetsLoaded: boolean
    }) => {
      mockMetadataFilterProps(props)
      return (
        <div data-testid="metadata-filter">
          {props.metadataList.map((metadata) => `${metadata.name}:${metadata.type}`).join(',')}
        </div>
      )
    },
  }),
)

vi.mock('@langgenius/dify-ui/checkbox', () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
  }: ComponentProps<'input'> & {
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@langgenius/dify-ui/input', () => ({
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@langgenius/dify-ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItemIndicator: () => null,
  SelectItemText: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ children, title }: { children: ReactNode; title: string }) => (
    <section>
      <div>{title}</div>
      {children}
    </section>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name }: { name: string }) => <div>{name}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({ default: () => null }))
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => <div data-testid="variable-picker" />,
}))

const panelProps: PanelProps = {
  getInputVars: () => [],
  toVarInputs: () => [],
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: undefined,
}

describe('KnowledgeRetrievalV2Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInputs.control_space_ids = ['space-1']
    mockUseQueries.mockReturnValue([
      {
        data: [
          {
            count: 2,
            createdAt: '2026-08-18T00:00:00.000Z',
            id: 'field-1',
            name: 'department',
            rowVersion: 1,
            type: 'string',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
        isSuccess: true,
      },
    ])
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                control_space_id: 'space-1',
                technical_status: 'available',
                technical_summary: {
                  name: 'Product docs',
                  model_profile: {
                    retrievalProfile: { defaultMode: 'deep', topK: 8, rerank: { enabled: true } },
                  },
                },
              },
              {
                control_space_id: 'space-2',
                technical_status: 'unavailable',
                technical_summary: { name: 'Archived docs' },
              },
            ],
            has_more: false,
            page: 1,
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  it('shows space profiles and wires bounded retrieval controls', () => {
    render(
      <Panel
        id="knowledge-retrieval-v2-1"
        data={{
          title: 'Knowledge Retrieval v2',
          desc: '',
          type: BlockEnum.KnowledgeRetrievalV2,
          query_variable_selector: ['start', 'query'],
          control_space_ids: ['space-1'],
          mode: 'research',
          top_n: 10,
        }}
        panelProps={panelProps}
      />,
    )

    expect(
      screen.getByText((_, element) => {
        const text = element?.textContent ?? ''
        return (
          element?.tagName === 'DIV' &&
          element.childElementCount === 0 &&
          text.includes('Product docs: deep') &&
          text.includes('profile.topK 8') &&
          text.includes('profile.rerank workflow.nodes.knowledgeRetrievalV2.profile.on')
        )
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('workflow.nodes.knowledgeRetrievalV2.mode.researchHint'),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Product docs/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Archived docs/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /Product docs/ }))
    expect(mockHandleSpaceToggle).toHaveBeenCalledWith(
      expect.objectContaining({ control_space_id: 'space-1', default_mode: 'deep', top_k: 8 }),
    )

    expect(screen.getByTestId('metadata-filter')).toHaveTextContent('department:string')
    expect(screen.queryByText('workflow.nodes.knowledgeRetrievalV2.filters.tags')).toBeNull()
    expect(mockMetadataFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowedModes: ['disabled', 'manual'],
        selectedDatasetsLoaded: true,
      }),
    )

    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '12' } })
    expect(mockHandleTopNChange).toHaveBeenCalledWith(12)
  })

  it('only offers user metadata shared by every selected knowledge space with the same type', () => {
    mockInputs.control_space_ids = ['space-1', 'space-2']
    mockUseQueries.mockReturnValue([
      {
        data: [
          { id: 'a', name: 'department', type: 'string' },
          { id: 'b', name: 'priority', type: 'number' },
          { id: 'c', name: 'space_one_only', type: 'string' },
        ],
        isSuccess: true,
      },
      {
        data: [
          { id: 'd', name: 'department', type: 'string' },
          { id: 'e', name: 'priority', type: 'string' },
        ],
        isSuccess: true,
      },
    ])

    render(
      <Panel
        id="knowledge-retrieval-v2-1"
        data={{
          title: 'Knowledge Retrieval v2',
          desc: '',
          type: BlockEnum.KnowledgeRetrievalV2,
          query_variable_selector: ['start', 'query'],
          control_space_ids: ['space-1', 'space-2'],
          top_n: 10,
        }}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByTestId('metadata-filter')).toHaveTextContent('department:string')
    expect(screen.getByTestId('metadata-filter')).not.toHaveTextContent('priority')
    expect(screen.getByTestId('metadata-filter')).not.toHaveTextContent('space_one_only')
  })

  it('does not treat a failed metadata catalog request as a completed empty catalog', () => {
    mockUseQueries.mockReturnValue([{ data: undefined, isSuccess: false }])

    render(
      <Panel
        id="knowledge-retrieval-v2-1"
        data={{
          title: 'Knowledge Retrieval v2',
          desc: '',
          type: BlockEnum.KnowledgeRetrievalV2,
          query_variable_selector: ['start', 'query'],
          control_space_ids: ['space-1'],
          top_n: 10,
        }}
        panelProps={panelProps}
      />,
    )

    expect(mockMetadataFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadataList: [], selectedDatasetsLoaded: false }),
    )
  })

  it('allows a selected space to be removed after it becomes unavailable', () => {
    mockInputs.control_space_ids = ['space-2']

    render(
      <Panel
        id="knowledge-retrieval-v2-1"
        data={{
          title: 'Knowledge Retrieval v2',
          desc: '',
          type: BlockEnum.KnowledgeRetrievalV2,
          query_variable_selector: ['start', 'query'],
          control_space_ids: ['space-2'],
          top_n: 10,
        }}
        panelProps={panelProps}
      />,
    )

    const selectedUnavailableSpace = screen.getByRole('checkbox', { name: /Archived docs/ })
    expect(selectedUnavailableSpace).toBeChecked()
    expect(selectedUnavailableSpace).toBeEnabled()
  })
})
