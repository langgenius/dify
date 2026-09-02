import type { KnowledgeRetrievalV2NodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const mockSetInputs = vi.fn()

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableNodesWithParent: [], availableVars: [] }),
}))

vi.mock('../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))

const mockUseNodeCrud = vi.mocked(useNodeCrud)

const createData = (
  overrides: Partial<KnowledgeRetrievalV2NodeType> = {},
): KnowledgeRetrievalV2NodeType => ({
  title: 'Knowledge Retrieval v2',
  desc: '',
  type: BlockEnum.KnowledgeRetrievalV2,
  query_variable_selector: ['start', 'sys.query'],
  control_space_ids: ['space-1'],
  top_n: 10,
  ...overrides,
})

describe('knowledge-retrieval-v2/use-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const setup = (inputs = createData()) => {
    mockUseNodeCrud.mockReturnValue({ inputs, setInputs: mockSetInputs } as never)
    return renderHook(() => useConfig('node-1', inputs))
  }

  it('updates the query selector', () => {
    const { result } = setup()

    act(() => result.current.handleQueryVarChange(['start', 'question']))

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        query_variable_selector: ['start', 'question'],
      }),
    )
  })

  it('updates an optional image selector and only accepts file variables', () => {
    const { result } = setup()

    act(() => result.current.handleQueryAttachmentChange(['start', 'images']))

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({ query_attachment_selector: ['start', 'images'] }),
    )
    expect(result.current.filterFileVar({ type: VarType.file } as never)).toBe(true)
    expect(result.current.filterFileVar({ type: VarType.arrayFile } as never)).toBe(true)
    expect(result.current.filterFileVar({ type: VarType.string } as never)).toBe(false)
  })

  it('keeps the selected space summary with the graph configuration', () => {
    const { result } = setup()

    act(() =>
      result.current.handleSpaceToggle({
        control_space_id: 'space-2',
        name: 'Product docs',
        default_mode: 'fast',
      }),
    )

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        control_space_ids: ['space-1', 'space-2'],
        _control_spaces: expect.arrayContaining([
          expect.objectContaining({ control_space_id: 'space-2', name: 'Product docs' }),
        ]),
      }),
    )
  })

  it('replaces the selected spaces in the same order returned by the selector', () => {
    const { result } = setup()

    act(() =>
      result.current.handleSpacesChange([
        { control_space_id: 'space-2', name: 'Policies' },
        { control_space_id: 'space-1', name: 'Product docs' },
      ]),
    )

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        control_space_ids: ['space-2', 'space-1'],
        _control_spaces: [
          { control_space_id: 'space-2', name: 'Policies' },
          { control_space_id: 'space-1', name: 'Product docs' },
        ],
      }),
    )
  })

  it('stores a custom rerank model and restores the system default by clearing the override', () => {
    const { result } = setup()

    act(() =>
      result.current.handleRerankingModelChange({
        provider: 'langgenius/cohere/cohere',
        model: 'rerank-v3.5',
      }),
    )
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reranking_model: {
          provider: 'langgenius/cohere/cohere',
          model: 'rerank-v3.5',
        },
      }),
    )

    const { result: configuredResult } = setup(
      createData({
        reranking_model: {
          provider: 'langgenius/cohere/cohere',
          model: 'rerank-v3.5',
        },
      }),
    )
    act(() => configuredResult.current.handleRerankingModelChange(undefined))
    expect(mockSetInputs.mock.lastCall?.[0]).toHaveProperty('reranking_model', undefined)
  })

  it('stores a bounded score threshold and supports disabling it', () => {
    const { result } = setup()

    act(() => result.current.handleScoreThresholdChange(0.72))
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({ score_threshold: 0.72 }),
    )

    act(() => result.current.handleScoreThresholdChange(null))
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({ score_threshold: null }),
    )

    mockSetInputs.mockClear()
    act(() => result.current.handleScoreThresholdChange(1.1))
    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('removes empty metadata filter collections', () => {
    const { result } = setup(createData({ metadata_filters: { tags: ['policy'] } }))

    act(() => result.current.handleMetadataFilterChange('tags', []))

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.not.objectContaining({
        metadata_filters: expect.anything(),
      }),
    )
  })

  it('adds a typed user metadata condition and enables manual filtering', () => {
    const { result } = setup()

    act(() => result.current.handleMetadataFilterModeChange(MetadataFilteringModeEnum.manual))
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata_filtering_mode: MetadataFilteringModeEnum.manual }),
    )

    act(() =>
      result.current.handleAddCondition({
        id: 'knowledge-fs:number:priority',
        name: 'priority',
        type: MetadataFilteringVariableType.number,
        value: 'priority',
      }),
    )

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_filtering_conditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            expect.objectContaining({
              comparison_operator: ComparisonOperator.equal,
              metadata_id: 'knowledge-fs:number:priority',
              metadata_type: MetadataFilteringVariableType.number,
              name: 'priority',
            }),
          ],
        },
      }),
    )
  })

  it('updates and combines custom metadata conditions without touching legacy filters', () => {
    const firstCondition = {
      comparison_operator: ComparisonOperator.is,
      id: 'condition-1',
      metadata_id: 'knowledge-fs:string:department',
      metadata_type: MetadataFilteringVariableType.string,
      name: 'department',
      value: 'finance',
    }
    const { result } = setup(
      createData({
        metadata_filters: { tags: ['legacy'] },
        metadata_filtering_conditions: {
          conditions: [firstCondition],
          logical_operator: LogicalOperator.and,
        },
      }),
    )

    act(() =>
      result.current.handleUpdateCondition('condition-1', {
        ...firstCondition,
        value: 'legal',
      }),
    )
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_filters: { tags: ['legacy'] },
        metadata_filtering_conditions: expect.objectContaining({
          conditions: [expect.objectContaining({ value: 'legal' })],
        }),
      }),
    )

    act(() => result.current.handleToggleConditionLogicalOperator())
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_filtering_conditions: expect.objectContaining({
          logical_operator: LogicalOperator.or,
        }),
      }),
    )
  })

  it('appends and removes custom metadata conditions without changing their field identity', () => {
    const firstCondition = {
      comparison_operator: ComparisonOperator.is,
      id: 'condition-1',
      metadata_id: 'knowledge-fs:string:department',
      metadata_type: MetadataFilteringVariableType.string,
      name: 'department',
      value: 'finance',
    }
    const secondCondition = {
      comparison_operator: ComparisonOperator.equal,
      id: 'condition-2',
      metadata_id: 'knowledge-fs:number:priority',
      metadata_type: MetadataFilteringVariableType.number,
      name: 'priority',
      value: 3,
    }
    const { result } = setup(
      createData({
        metadata_filtering_conditions: {
          conditions: [firstCondition, secondCondition],
          logical_operator: LogicalOperator.and,
        },
      }),
    )

    act(() =>
      result.current.handleAddCondition({
        id: 'knowledge-fs:time:reviewed_at',
        name: 'reviewed_at',
        type: MetadataFilteringVariableType.time,
        value: 'reviewed_at',
      }),
    )
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_filtering_conditions: expect.objectContaining({
          conditions: expect.arrayContaining([
            expect.objectContaining({
              comparison_operator: ComparisonOperator.is,
              metadata_id: 'knowledge-fs:time:reviewed_at',
              metadata_type: MetadataFilteringVariableType.time,
            }),
          ]),
        }),
      }),
    )

    act(() => result.current.handleRemoveCondition('condition-1'))
    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_filtering_conditions: expect.objectContaining({
          conditions: [expect.objectContaining({ id: 'condition-2' })],
        }),
      }),
    )
  })

  it('enables automatic metadata filtering and normalizes unknown modes to disabled', () => {
    const { result } = setup()

    act(() => result.current.handleMetadataFilterModeChange(MetadataFilteringModeEnum.automatic))

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata_filtering_mode: MetadataFilteringModeEnum.automatic }),
    )

    act(() => result.current.handleMetadataFilterModeChange('unknown' as MetadataFilteringModeEnum))

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata_filtering_mode: MetadataFilteringModeEnum.disabled }),
    )
  })

  it('stores the automatic metadata filtering model with default completion params', () => {
    const { result } = setup()

    act(() =>
      result.current.handleMetadataModelChange({ provider: 'openai', modelId: 'gpt-4o-mini' }),
    )

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_model_config: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: { temperature: 0.7 },
        },
      }),
    )
  })

  it('keeps tuned completion params when the automatic metadata model changes', () => {
    const { result } = setup(
      createData({
        metadata_model_config: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: { temperature: 0.1 },
        },
      }),
    )

    act(() =>
      result.current.handleMetadataModelChange({
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        mode: 'completion',
      }),
    )

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_model_config: {
          provider: 'anthropic',
          name: 'claude-sonnet-5',
          mode: 'completion',
          completion_params: { temperature: 0.1 },
        },
      }),
    )

    act(() => result.current.handleMetadataCompletionParamsChange({ temperature: 0.4 }))

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata_model_config: expect.objectContaining({
          completion_params: { temperature: 0.4 },
        }),
      }),
    )
  })

  it('ignores completion params until an automatic metadata model is selected', () => {
    const { result } = setup()

    act(() => result.current.handleMetadataCompletionParamsChange({ temperature: 0.4 }))

    expect(mockSetInputs).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ metadata_model_config: expect.anything() }),
    )
  })

  it('rejects an out-of-range top n in the editor', () => {
    const { result } = setup()

    act(() => result.current.handleTopNChange(101))

    expect(mockSetInputs).not.toHaveBeenCalled()
  })
})
