import type { MutableRefObject } from 'react'
import type { KnowledgeRetrievalNodeType, MetadataFilteringCondition } from '../../types'
import { act, renderHook } from '@testing-library/react'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '../../types'
import useKnowledgeMetadataConfig from '../use-knowledge-metadata-config'

let uuidCounter = 0

vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    uuidCounter += 1
    return `condition-${uuidCounter}`
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseAvailableVarList = vi.mocked(useAvailableVarList)

const createPayload = (overrides: Partial<KnowledgeRetrievalNodeType> = {}): KnowledgeRetrievalNodeType => ({
  title: 'Knowledge Retrieval',
  desc: '',
  type: BlockEnum.KnowledgeRetrieval,
  query_variable_selector: [],
  query_attachment_selector: [],
  dataset_ids: [],
  retrieval_mode: 'multiway' as KnowledgeRetrievalNodeType['retrieval_mode'],
  multiple_retrieval_config: undefined,
  single_retrieval_config: undefined,
  metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
  metadata_filtering_conditions: undefined,
  metadata_model_config: undefined,
  ...overrides,
})

const createState = (initialInputs: KnowledgeRetrievalNodeType) => {
  const inputRef = { current: initialInputs } as MutableRefObject<KnowledgeRetrievalNodeType>
  const setInputs = vi.fn((nextInputs: KnowledgeRetrievalNodeType) => {
    inputRef.current = nextInputs
  })

  return { inputRef, setInputs }
}

describe('use-knowledge-metadata-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uuidCounter = 0

    mockUseAvailableVarList.mockImplementation((_id, config) => {
      const activeConfig = config!
      if (activeConfig.filterVar({ type: VarType.string } as never, ['string-node', 'topic'])) {
        return {
          availableVars: [{ nodeId: 'string-node', title: 'String Node', vars: [{ variable: 'topic', type: VarType.string }] }],
          availableNodes: [],
          availableNodesWithParent: [{ id: 'string-node', data: { title: 'String Node' } }],
        } as unknown as ReturnType<typeof useAvailableVarList>
      }

      return {
        availableVars: [{ nodeId: 'number-node', title: 'Number Node', vars: [{ variable: 'score', type: VarType.number }] }],
        availableNodes: [],
        availableNodesWithParent: [{ id: 'number-node', data: { title: 'Number Node' } }],
      } as unknown as ReturnType<typeof useAvailableVarList>
    })
  })

  it('manages metadata filters, conditions, model state, and available vars', () => {
    const { inputRef, setInputs } = createState(createPayload())
    const { result } = renderHook(() => useKnowledgeMetadataConfig({
      id: 'knowledge-node',
      inputRef,
      setInputs,
    }))

    act(() => {
      result.current.handleMetadataFilterModeChange(MetadataFilteringModeEnum.manual)
      result.current.handleAddCondition({
        id: 'meta-1',
        name: 'topic',
        type: MetadataFilteringVariableType.string,
        value: 'topic',
      })
      result.current.handleAddCondition({
        id: 'meta-2',
        name: 'score',
        type: MetadataFilteringVariableType.number,
        value: '10',
      })
    })

    const firstCondition = setInputs.mock.calls[1]![0].metadata_filtering_conditions!.conditions[0] as MetadataFilteringCondition
    const secondCondition = setInputs.mock.calls[2]![0].metadata_filtering_conditions!.conditions[1] as MetadataFilteringCondition

    act(() => {
      result.current.handleUpdateCondition(secondCondition.id, {
        ...secondCondition,
        comparison_operator: ComparisonOperator.largerThan,
        value: 0.8,
      })
      result.current.handleToggleConditionLogicalOperator()
      result.current.handleRemoveCondition(firstCondition.id)
      result.current.handleMetadataModelChange({
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
        mode: AppModeEnum.CHAT,
      })
      result.current.handleMetadataCompletionParamsChange({ top_p: 0.3 })
    })

    expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata_model_config: {
        provider: 'openai',
        name: 'gpt-4.1-mini',
        mode: AppModeEnum.CHAT,
        completion_params: { top_p: 0.3 },
      },
    }))
    expect(inputRef.current.metadata_filtering_mode).toBe(MetadataFilteringModeEnum.manual)
    expect(inputRef.current.metadata_filtering_conditions).toEqual({
      logical_operator: LogicalOperator.or,
      conditions: [{
        ...secondCondition,
        comparison_operator: ComparisonOperator.largerThan,
        value: 0.8,
      }],
    })
    expect(result.current.availableStringVars).toEqual([{ nodeId: 'string-node', title: 'String Node', vars: [{ variable: 'topic', type: VarType.string }] }])
    expect(result.current.availableNumberVars).toEqual([{ nodeId: 'number-node', title: 'Number Node', vars: [{ variable: 'score', type: VarType.number }] }])
    expect(result.current.availableStringNodesWithParent).toEqual([{ id: 'string-node', data: { title: 'String Node' } }])
    expect(result.current.availableNumberNodesWithParent).toEqual([{ id: 'number-node', data: { title: 'Number Node' } }])
    expect(result.current.filterStringVar({ type: VarType.string } as never)).toBe(true)
    expect(result.current.filterStringVar({ type: VarType.number } as never)).toBe(false)
    expect(result.current.filterFileVar({ type: VarType.file } as never)).toBe(true)
    expect(result.current.filterFileVar({ type: VarType.arrayFile } as never)).toBe(true)
    expect(result.current.filterFileVar({ type: VarType.boolean } as never)).toBe(false)
  })

  it('keeps state unchanged when removing or updating a missing condition', () => {
    const initialPayload = createPayload({
      metadata_filtering_conditions: {
        logical_operator: LogicalOperator.and,
        conditions: [{
          id: 'condition-existing',
          metadata_id: 'meta-1',
          name: 'topic',
          comparison_operator: ComparisonOperator.is,
          value: 'city',
        }],
      },
      metadata_model_config: {
        provider: 'openai',
        name: 'gpt-4.1-mini',
        mode: AppModeEnum.CHAT,
        completion_params: { temperature: 0.7 },
      },
    })
    const { inputRef, setInputs } = createState(initialPayload)
    const { result } = renderHook(() => useKnowledgeMetadataConfig({
      id: 'knowledge-node',
      inputRef,
      setInputs,
    }))

    act(() => {
      result.current.handleRemoveCondition('missing-condition')
      result.current.handleUpdateCondition('missing-condition', {
        id: 'missing-condition',
        metadata_id: 'meta-x',
        name: 'missing',
        comparison_operator: ComparisonOperator.isNot,
        value: 'unused',
      })
    })

    expect(setInputs).toHaveBeenNthCalledWith(1, initialPayload)
    expect(setInputs).toHaveBeenNthCalledWith(2, initialPayload)
  })

  it('falls back to chat mode, preserves completion params, and toggles or back to and', () => {
    const initialPayload = createPayload({
      metadata_filtering_conditions: {
        logical_operator: LogicalOperator.or,
        conditions: [{
          id: 'condition-existing',
          metadata_id: 'meta-1',
          name: 'topic',
          comparison_operator: ComparisonOperator.is,
          value: 'city',
        }],
      },
      metadata_model_config: {
        provider: 'openai',
        name: 'gpt-4.1-mini',
        mode: AppModeEnum.CHAT,
        completion_params: { temperature: 0.9 },
      },
    })
    const { inputRef, setInputs } = createState(initialPayload)
    const { result } = renderHook(() => useKnowledgeMetadataConfig({
      id: 'knowledge-node',
      inputRef,
      setInputs,
    }))

    act(() => {
      result.current.handleToggleConditionLogicalOperator()
      result.current.handleMetadataModelChange({
        provider: 'anthropic',
        modelId: 'claude-sonnet',
      })
    })

    expect(inputRef.current.metadata_filtering_conditions?.logical_operator).toBe(LogicalOperator.and)
    expect(inputRef.current.metadata_model_config).toEqual({
      provider: 'anthropic',
      name: 'claude-sonnet',
      mode: AppModeEnum.CHAT,
      completion_params: { temperature: 0.9 },
    })
  })

  it('handles missing metadata condition containers when removing or updating', () => {
    const initialPayload = createPayload({
      metadata_filtering_conditions: undefined,
    })
    const { inputRef, setInputs } = createState(initialPayload)
    const { result } = renderHook(() => useKnowledgeMetadataConfig({
      id: 'knowledge-node',
      inputRef,
      setInputs,
    }))

    act(() => {
      result.current.handleRemoveCondition('missing-condition')
      result.current.handleUpdateCondition('missing-condition', {
        id: 'missing-condition',
        metadata_id: 'meta-x',
        name: 'missing',
        comparison_operator: ComparisonOperator.isNot,
        value: 'unused',
      })
    })

    expect(setInputs).toHaveBeenNthCalledWith(1, initialPayload)
    expect(setInputs).toHaveBeenNthCalledWith(2, initialPayload)
  })
})
