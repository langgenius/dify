import type { CodeNodeType, OutputVar } from '../types'
import type { Var, Variable } from '@/app/components/workflow/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { fetchNodeDefault, fetchPipelineNodeDefault } from '@/service/workflow'
import useOutputVarList from '../../_base/hooks/use-output-var-list'
import useVarList from '../../_base/hooks/use-var-list'
import { CodeLanguage } from '../types'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-output-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  fetchNodeDefault: vi.fn(),
  fetchPipelineNodeDefault: vi.fn(),
}))

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseVarList = vi.mocked(useVarList)
const mockUseOutputVarList = vi.mocked(useOutputVarList)
const mockUseStore = vi.mocked(useStore)
const mockFetchNodeDefault = vi.mocked(fetchNodeDefault)
const mockFetchPipelineNodeDefault = vi.mocked(fetchPipelineNodeDefault)

const createVariable = (variable: string, valueType: VarType = VarType.string): Variable => ({
  variable,
  value_selector: ['start', variable],
  value_type: valueType,
})

const createOutputs = (name = 'result', type: VarType = VarType.string): OutputVar => ({
  [name]: {
    type,
    children: null,
  },
})

const createData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  code_language: CodeLanguage.javascript,
  code: 'function main({ foo }) { return { result: foo } }',
  variables: [createVariable('foo')],
  outputs: createOutputs(),
  ...overrides,
})

describe('code/use-config', () => {
  const mockSetInputs = vi.fn()
  const mockHandleVarListChange = vi.fn()
  const mockHandleAddVariable = vi.fn()
  const mockHandleVarsChange = vi.fn()
  const mockHandleAddOutputVariable = vi.fn()
  const mockHandleRemoveVariable = vi.fn()
  const mockHideRemoveVarConfirm = vi.fn()
  const mockOnRemoveVarConfirm = vi.fn()

  let workflowStoreState: {
    appId?: string
    pipelineId?: string
    nodesDefaultConfigs?: Record<string, CodeNodeType>
  }
  let currentInputs: CodeNodeType
  let javaScriptConfig: CodeNodeType
  let pythonConfig: CodeNodeType

  beforeEach(() => {
    vi.clearAllMocks()

    javaScriptConfig = createData({
      code_language: CodeLanguage.javascript,
      code: 'function main({ query }) { return { result: query } }',
      variables: [createVariable('query')],
      outputs: createOutputs('result'),
    })
    pythonConfig = createData({
      code_language: CodeLanguage.python3,
      code: 'def main(name: str):\n    return {"result": name}',
      variables: [createVariable('name')],
      outputs: createOutputs('result'),
    })
    currentInputs = createData()
    workflowStoreState = {
      appId: undefined,
      pipelineId: undefined,
      nodesDefaultConfigs: {
        [BlockEnum.Code]: createData({
          code_language: CodeLanguage.javascript,
          code: 'function main() { return { default_result: "" } }',
          variables: [],
          outputs: createOutputs('default_result'),
        }),
      },
    }

    mockUseNodesReadOnly.mockReturnValue({
      nodesReadOnly: false,
      getNodesReadOnly: () => false,
    })
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    }))
    mockUseVarList.mockReturnValue({
      handleVarListChange: mockHandleVarListChange,
      handleAddVariable: mockHandleAddVariable,
    } as ReturnType<typeof useVarList>)
    mockUseOutputVarList.mockReturnValue({
      handleVarsChange: mockHandleVarsChange,
      handleAddVariable: mockHandleAddOutputVariable,
      handleRemoveVariable: mockHandleRemoveVariable,
      isShowRemoveVarConfirm: false,
      hideRemoveVarConfirm: mockHideRemoveVarConfirm,
      onRemoveVarConfirm: mockOnRemoveVarConfirm,
    } as ReturnType<typeof useOutputVarList>)
    mockUseStore.mockImplementation(selector => selector(workflowStoreState as never))
    mockFetchNodeDefault.mockResolvedValue({ config: javaScriptConfig } as never)
    mockFetchPipelineNodeDefault.mockResolvedValue({ config: javaScriptConfig } as never)
    mockFetchNodeDefault
      .mockResolvedValueOnce({ config: javaScriptConfig } as never)
      .mockResolvedValueOnce({ config: pythonConfig } as never)
    mockFetchPipelineNodeDefault
      .mockResolvedValueOnce({ config: javaScriptConfig } as never)
      .mockResolvedValueOnce({ config: pythonConfig } as never)
  })

  it('hydrates node defaults when the code payload is empty and syncs output key order', async () => {
    currentInputs = createData({
      code: '',
      variables: [],
      outputs: {},
    })

    const { result } = renderHook(() => useConfig('code-node', currentInputs))

    await waitFor(() => {
      expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
        code: workflowStoreState.nodesDefaultConfigs?.[BlockEnum.Code]?.code,
        outputs: workflowStoreState.nodesDefaultConfigs?.[BlockEnum.Code]?.outputs,
      }))
    })

    expect(result.current.handleVarListChange).toBe(mockHandleVarListChange)
    expect(result.current.handleAddVariable).toBe(mockHandleAddVariable)
    expect(result.current.handleVarsChange).toBe(mockHandleVarsChange)
    expect(result.current.handleAddOutputVariable).toBe(mockHandleAddOutputVariable)
    expect(result.current.handleRemoveVariable).toBe(mockHandleRemoveVariable)
    expect(result.current.hideRemoveVarConfirm).toBe(mockHideRemoveVarConfirm)
    expect(result.current.onRemoveVarConfirm).toBe(mockOnRemoveVarConfirm)
    expect(result.current.outputKeyOrders).toEqual(['default_result'])
    expect(result.current.filterVar({ type: VarType.file } as Var)).toBe(true)
    expect(result.current.filterVar({ type: VarType.secret } as Var)).toBe(true)
  })

  it('fetches app and pipeline defaults, switches language, and updates code and output vars together', async () => {
    workflowStoreState.appId = 'app-1'
    workflowStoreState.pipelineId = 'pipeline-1'

    const { result } = renderHook(() => useConfig('code-node', currentInputs))

    await waitFor(() => {
      expect(mockFetchNodeDefault).toHaveBeenCalledWith('app-1', BlockEnum.Code, { code_language: CodeLanguage.javascript })
      expect(mockFetchNodeDefault).toHaveBeenCalledWith('app-1', BlockEnum.Code, { code_language: CodeLanguage.python3 })
      expect(mockFetchPipelineNodeDefault).toHaveBeenCalledWith('pipeline-1', BlockEnum.Code, { code_language: CodeLanguage.javascript })
      expect(mockFetchPipelineNodeDefault).toHaveBeenCalledWith('pipeline-1', BlockEnum.Code, { code_language: CodeLanguage.python3 })
    })

    mockSetInputs.mockClear()

    act(() => {
      result.current.handleCodeLanguageChange(CodeLanguage.python3)
      result.current.handleCodeChange('function main({ bar }) { return { result: bar } }')
      result.current.handleCodeAndVarsChange(
        'function main({ amount }) { return { total: amount } }',
        [createVariable('amount', VarType.number)],
        createOutputs('total', VarType.number),
      )
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      code_language: CodeLanguage.python3,
      code: pythonConfig.code,
      variables: pythonConfig.variables,
      outputs: pythonConfig.outputs,
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      code: 'function main({ bar }) { return { result: bar } }',
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      code: 'function main({ amount }) { return { total: amount } }',
      variables: [expect.objectContaining({ variable: 'amount' })],
      outputs: createOutputs('total', VarType.number),
    }))
    expect(result.current.outputKeyOrders).toEqual(['total'])
  })

  it('syncs javascript and python function signatures and keeps json code unchanged', () => {
    currentInputs = createData({
      code_language: CodeLanguage.javascript,
      code: 'function main() { return { result: "" } }',
      variables: [createVariable('foo'), createVariable('bar')],
    })

    const { result, rerender } = renderHook(() => useConfig('code-node', currentInputs))

    act(() => {
      result.current.handleSyncFunctionSignature()
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      code: 'function main({foo, bar}) { return { result: "" } }',
    }))

    mockSetInputs.mockClear()
    currentInputs = createData({
      code_language: CodeLanguage.python3,
      code: 'def main():\n    return {"result": ""}',
      variables: [
        createVariable('text', VarType.string),
        createVariable('score', VarType.number),
        createVariable('payload', VarType.object),
        createVariable('items', VarType.array),
        createVariable('numbers', VarType.arrayNumber),
        createVariable('names', VarType.arrayString),
        createVariable('records', VarType.arrayObject),
      ],
    })
    rerender()

    act(() => {
      result.current.handleSyncFunctionSignature()
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      code: 'def main(text: str, score: float, payload: dict, items: list, numbers: list[float], names: list[str], records: list[dict]):\n    return {"result": ""}',
    }))

    mockSetInputs.mockClear()
    currentInputs = createData({
      code_language: CodeLanguage.json,
      code: '{"result": true}',
    })
    rerender()

    act(() => {
      result.current.handleSyncFunctionSignature()
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      code: '{"result": true}',
    }))
  })

  it('keeps language changes local when no fetched default exists and preserves existing output order', async () => {
    currentInputs = createData({
      outputs: {
        summary: {
          type: VarType.string,
          children: null,
        },
        count: {
          type: VarType.number,
          children: null,
        },
      },
    })
    workflowStoreState.appId = undefined
    workflowStoreState.pipelineId = undefined

    const { result } = renderHook(() => useConfig('code-node', currentInputs))

    await waitFor(() => {
      expect(result.current.outputKeyOrders).toEqual(['summary', 'count'])
    })

    mockSetInputs.mockClear()

    act(() => {
      result.current.handleCodeLanguageChange(CodeLanguage.python3)
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      code_language: CodeLanguage.python3,
      code: currentInputs.code,
      variables: currentInputs.variables,
      outputs: currentInputs.outputs,
    }))
  })
})
