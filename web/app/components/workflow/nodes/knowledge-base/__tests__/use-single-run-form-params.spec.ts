import type { KnowledgeBaseNodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { ChunkStructureEnum, IndexMethodEnum, RetrievalSearchMethodEnum } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

const createPayload = (overrides: Partial<KnowledgeBaseNodeType> = {}): KnowledgeBaseNodeType => ({
  title: 'Knowledge Base',
  desc: '',
  type: BlockEnum.KnowledgeBase,
  index_chunk_variable_selector: ['chunks', 'results'],
  chunk_structure: ChunkStructureEnum.general,
  indexing_technique: IndexMethodEnum.QUALIFIED,
  embedding_model: 'text-embedding-3-large',
  embedding_model_provider: 'openai',
  keyword_number: 10,
  retrieval_model: {
    search_method: RetrievalSearchMethodEnum.semantic,
    reranking_enable: false,
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  },
  ...overrides,
})

describe('useSingleRunFormParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The hook should expose the single query form and map chunk dependencies for single-run execution.
  describe('Forms', () => {
    it('should build the query form with the current run input value', () => {
      const { result } = renderHook(() => useSingleRunFormParams({
        id: 'knowledge-base-1',
        payload: createPayload(),
        runInputData: { query: 'what is dify' },
        getInputVars: vi.fn(),
        setRunInputData: vi.fn(),
        toVarInputs: vi.fn(),
      }))

      expect(result.current.forms).toHaveLength(1)
      expect(result.current.forms[0]!.inputs).toEqual([{
        label: 'workflow.nodes.common.inputVars',
        variable: 'query',
        type: InputVarType.paragraph,
        required: true,
      }])
      expect(result.current.forms[0]!.values).toEqual({ query: 'what is dify' })
    })

    it('should update run input data when the query changes', () => {
      const setRunInputData = vi.fn()
      const { result } = renderHook(() => useSingleRunFormParams({
        id: 'knowledge-base-1',
        payload: createPayload(),
        runInputData: { query: 'old query' },
        getInputVars: vi.fn(),
        setRunInputData,
        toVarInputs: vi.fn(),
      }))

      act(() => {
        result.current.forms[0]!.onChange({ query: 'new query' })
      })

      expect(setRunInputData).toHaveBeenCalledWith({ query: 'new query' })
    })
  })

  describe('Dependencies', () => {
    it('should expose the chunk selector as the only dependent variable', () => {
      const payload = createPayload({
        index_chunk_variable_selector: ['node-1', 'chunks'],
      })

      const { result } = renderHook(() => useSingleRunFormParams({
        id: 'knowledge-base-1',
        payload,
        runInputData: {},
        getInputVars: vi.fn(),
        setRunInputData: vi.fn(),
        toVarInputs: vi.fn(),
      }))

      expect(result.current.getDependentVars()).toEqual([['node-1', 'chunks']])
      expect(result.current.getDependentVar('query')).toEqual(['node-1', 'chunks'])
      expect(result.current.getDependentVar('other')).toBeUndefined()
    })
  })
})
