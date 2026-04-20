import type { AgentNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import formatTracing from '@/app/components/workflow/run/utils/format-log'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { VarType } from '../../tool/types'
import { useStrategyInfo } from '../use-config'
import useSingleRunFormParams from '../use-single-run-form-params'

vi.mock('@/app/components/workflow/run/utils/format-log', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../../_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../use-config', async () => {
  const actual = await vi.importActual<typeof import('../use-config')>('../use-config')
  return {
    ...actual,
    useStrategyInfo: vi.fn(),
  }
})

const mockFormatTracing = vi.mocked(formatTracing)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseStrategyInfo = vi.mocked(useStrategyInfo)

const createData = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
  output_schema: {},
  agent_strategy_provider_name: 'provider/agent',
  agent_strategy_name: 'react',
  agent_strategy_label: 'React Agent',
  agent_parameters: {
    prompt: {
      type: VarType.variable,
      value: '#start.topic#',
    },
    summary: {
      type: VarType.variable,
      value: '#node-2.answer#',
    },
    count: {
      type: VarType.constant,
      value: 2,
    },
  },
  ...overrides,
})

describe('agent/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: vi.fn(),
    } as unknown as ReturnType<typeof useNodeCrud>)
    mockUseStrategyInfo.mockReturnValue({
      strategyProvider: undefined,
      strategy: {
        parameters: [
          { name: 'prompt', type: 'string' },
          { name: 'summary', type: 'string' },
          { name: 'count', type: 'number' },
        ],
      },
      strategyStatus: undefined,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useStrategyInfo>)
    mockFormatTracing.mockReturnValue([{
      id: 'agent-node',
      status: 'succeeded',
    }] as unknown as ReturnType<typeof formatTracing>)
  })

  it('builds a single-run variable form, returns node info, and skips malformed dependent vars', () => {
    const setRunInputData = vi.fn()
    const getInputVars = vi.fn<() => InputVar[]>(() => [
      {
        label: 'Prompt',
        variable: '#start.topic#',
        type: InputVarType.textInput,
        required: true,
      },
      {
        label: 'Broken',
        variable: undefined as unknown as string,
        type: InputVarType.textInput,
        required: false,
      },
    ])

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'agent-node',
      payload: createData(),
      runInputData: { topic: 'finance' },
      runInputDataRef: { current: { topic: 'finance' } },
      getInputVars,
      setRunInputData,
      toVarInputs: () => [],
      runResult: { id: 'trace-1' } as never,
    }))

    expect(getInputVars).toHaveBeenCalledWith(['#start.topic#', '#node-2.answer#'])
    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.inputs).toHaveLength(2)
    expect(result.current.forms[0]!.values).toEqual({ topic: 'finance' })
    expect(result.current.nodeInfo).toEqual({
      id: 'agent-node',
      status: 'succeeded',
    })

    result.current.forms[0]!.onChange({ topic: 'updated' })

    expect(setRunInputData).toHaveBeenCalledWith({ topic: 'updated' })
    expect(result.current.getDependentVars()).toEqual([
      ['start', 'topic'],
    ])
  })

  it('returns an empty form list when no variable input is required and no run result is available', () => {
    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'agent-node',
      payload: createData(),
      runInputData: {},
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData: vi.fn(),
      toVarInputs: () => [],
      runResult: undefined as never,
    }))

    expect(result.current.forms).toEqual([])
    expect(result.current.nodeInfo).toBeUndefined()
    expect(result.current.getDependentVars()).toEqual([])
  })
})
