import type { ToolNodeType } from '../../types'
import type { InputVar } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'
import { act } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook as renderHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseToolIcon = vi.hoisted(() => vi.fn())

vi.mock('../../../../hooks/use-tool-icon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-tool-icon')>()

  return {
    ...actual,
    useToolIcon: (...args: unknown[]) => mockUseToolIcon(...args),
  }
})

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

const createRunResult = () =>
  createNodeTracing({
    node_id: 'tool-node-1',
    node_type: BlockEnum.Tool,
    title: 'Google Search',
    status: 'succeeded',
  })

describe('useSingleRunFormParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseToolIcon.mockReturnValue('tool-icon')
  })

  describe('Variable Extraction', () => {
    it('should build form inputs from variable params and settings and expose dependent vars', () => {
      const payload = createNodeData({
        tool_parameters: {
          query: { type: VarKindType.variable, value: ['start', 'query'] },
          legacy_query: { type: VarKindType.variable, value: 'legacy.answer' },
          constant_query: { type: VarKindType.constant, value: 'fixed' },
        },
        tool_configurations: {
          prompt: { type: VarKindType.mixed, value: 'prefix {{#tool.result#}}' },
          api_key: { type: VarKindType.constant, value: 'secret' },
          plainText: 'ignored',
        },
      })
      const getInputVars = vi.fn(() => [
        createInputVar('#start.query#'),
        createInputVar(undefined as unknown as string),
        createInputVar('#legacy.answer#'),
      ])

      const { result } = renderHook(() =>
        useSingleRunFormParams({
          id: 'tool-node-1',
          payload,
          runInputData: {},
          runInputDataRef: { current: {} },
          getInputVars,
          setRunInputData: vi.fn(),
          toVarInputs: vi.fn(),
          runResult: null as unknown as NodeTracing,
        }),
      )

      expect(getInputVars).toHaveBeenCalledWith([
        '{{#start.query#}}',
        '{{#legacy.answer#}}',
        'prefix {{#tool.result#}}',
      ])
      expect(result.current.forms[0]!.inputs).toEqual([
        createInputVar('#start.query#'),
        createInputVar(undefined as unknown as string),
        createInputVar('#legacy.answer#'),
      ])
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
          nullable_constant: { type: VarKindType.constant, value: null },
          query: { type: VarKindType.variable, value: ['start', 'query'] },
        },
      })
      const getInputVars = vi.fn(() => [createInputVar('#start.query#')])
      const setRunInputData = vi.fn()

      const { result } = renderHook(() =>
        useSingleRunFormParams({
          id: 'tool-node-1',
          payload,
          runInputData: {},
          runInputDataRef: { current: {} },
          getInputVars,
          setRunInputData,
          toVarInputs: vi.fn(),
          runResult: null as unknown as NodeTracing,
        }),
      )

      act(() => {
        result.current.forms[0]!.onChange({
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
      expect(result.current.forms[0]!.values).toEqual({
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

      const { result } = renderHook(() =>
        useSingleRunFormParams({
          id: 'tool-node-1',
          payload,
          runInputData: {},
          runInputDataRef: { current: {} },
          getInputVars: vi.fn(() => []),
          setRunInputData: vi.fn(),
          toVarInputs: vi.fn(),
          runResult,
        }),
      )

      expect(result.current.nodeInfo).toMatchObject(runResult)
    })
  })
})
