import type { ToolNodeType, VarType } from '../../types'
import type { InputVar } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'
import { act, renderHook } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseToolIcon = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockFormatToTracingNodeList = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useToolIcon: (...args: unknown[]) => mockUseToolIcon(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('@/app/components/workflow/run/utils/format-log', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatToTracingNodeList(...args),
}))

const createNodeData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Google Search',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: 'google_search',
  provider_type: CollectionType.builtIn,
  provider_name: 'Google Search',
  tool_name: 'google_search',
  tool_label: 'Google Search',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

const createInputVar = (variable: InputVar['variable']): InputVar => ({
  type: InputVarType.textInput,
  label: typeof variable === 'string' ? variable : 'invalid',
  variable,
  required: false,
})

const createRunResult = (): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'tool-node-1',
  node_type: BlockEnum.Tool,
  title: 'Google Search',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: 'succeeded',
  elapsed_time: 1,
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
  },
  finished_at: 1,
})

describe('useSingleRunFormParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseToolIcon.mockReturnValue('tool-icon')
    mockFormatToTracingNodeList.mockReturnValue([{ id: 'formatted-node' }])
    mockUseNodeCrud.mockImplementation((_id: string, payload: ToolNodeType) => ({
      inputs: payload,
    }))
  })

  describe('Variable Extraction', () => {
    it('should build form inputs from variable params and settings and expose dependent vars', () => {
      const payload = createNodeData({
        tool_parameters: {
          query: { type: 'variable' as VarType, value: ['start', 'query'] },
          legacy_query: { type: 'variable' as VarType, value: 'legacy.answer' },
          constant_query: { type: 'constant' as VarType, value: 'fixed' },
        },
        tool_configurations: {
          prompt: { type: 'mixed' as VarType, value: 'prefix {{#tool.result#}}' },
          api_key: { type: 'constant' as VarType, value: 'secret' },
          plainText: 'ignored',
        },
      })
      const getInputVars = vi.fn(() => [
        createInputVar('#start.query#'),
        createInputVar(undefined as unknown as string),
        createInputVar('#legacy.answer#'),
      ])

      const { result } = renderHook(() => useSingleRunFormParams({
        id: 'tool-node-1',
        payload,
        runInputData: {},
        runInputDataRef: { current: {} },
        getInputVars,
        setRunInputData: vi.fn(),
        toVarInputs: vi.fn(),
        runResult: null as unknown as NodeTracing,
      }))

      expect(getInputVars).toHaveBeenCalledWith([
        '{{#start.query#}}',
        '{{#legacy.answer#}}',
        'prefix {{#tool.result#}}',
      ])
      expect(result.current.forms).toHaveLength(1)
      expect(result.current.forms[0].inputs).toEqual([
        createInputVar('#start.query#'),
        createInputVar(undefined as unknown as string),
        createInputVar('#legacy.answer#'),
      ])
      expect(result.current.forms[0].values).toEqual({})
      expect(result.current.toolIcon).toBe('tool-icon')
      expect(result.current.getDependentVars()).toEqual([
        ['start', 'query'],
        ['legacy', 'answer'],
      ])
      expect(result.current.nodeInfo).toBeNull()
    })
  })

  describe('Form Updates', () => {
    it('should update form values and forward run input data on change', () => {
      const payload = createNodeData({
        tool_parameters: {
          nullable_constant: { type: 'constant' as VarType, value: null },
          query: { type: 'variable' as VarType, value: ['start', 'query'] },
        },
      })
      const getInputVars = vi.fn(() => [createInputVar('#start.query#')])
      const setRunInputData = vi.fn()

      const { result } = renderHook(() => useSingleRunFormParams({
        id: 'tool-node-1',
        payload,
        runInputData: {},
        runInputDataRef: { current: {} },
        getInputVars,
        setRunInputData,
        toVarInputs: vi.fn(),
        runResult: null as unknown as NodeTracing,
      }))

      act(() => {
        result.current.forms[0].onChange({
          query: 'weather',
          tool_parameters: {
            nullable_constant: 'temp-value',
          },
        })
      })

      expect(setRunInputData).toHaveBeenCalledWith({
        query: 'weather',
        tool_parameters: {
          nullable_constant: 'temp-value',
        },
      })
      expect(result.current.forms[0].values).toEqual({
        query: 'weather',
        tool_parameters: {
          nullable_constant: 'temp-value',
        },
        nullable_constant: null,
      })
    })
  })

  describe('Tracing Data', () => {
    it('should format the latest run result into node info when a run result exists', () => {
      const payload = createNodeData()
      const runResult = createRunResult()

      const { result } = renderHook(() => useSingleRunFormParams({
        id: 'tool-node-1',
        payload,
        runInputData: {},
        runInputDataRef: { current: {} },
        getInputVars: vi.fn(() => []),
        setRunInputData: vi.fn(),
        toVarInputs: vi.fn(),
        runResult,
      }))

      expect(mockFormatToTracingNodeList).toHaveBeenCalledWith([runResult], expect.any(Function))
      expect(result.current.nodeInfo).toEqual({ id: 'formatted-node' })
    })
  })
})
