import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import { act, renderHook } from '@testing-library/react'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useOutputVarList from '../use-output-var-list'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockOnOutputKeyOrdersChange = vi.hoisted(() => vi.fn())
const mockHandleOutVarRenameChange = vi.hoisted(() => vi.fn())
const mockIsVarUsedInNodes = vi.hoisted(() => vi.fn())
const mockRemoveUsedVarInNodes = vi.hoisted(() => vi.fn())
const mockDeleteInspectVar = vi.hoisted(() => vi.fn())
const mockRenameInspectVarName = vi.hoisted(() => vi.fn())
const inspectState = vi.hoisted(() => ({
  nodesWithInspectVars: [] as Array<{
    nodeId: string
    vars: Array<{ id: string; name: string }>
  }>,
}))

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: unknown[]) => void) => ({
    run: fn,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/components/workflow/hooks/use-workflow')>()

  return {
    ...actual,
    useWorkflow: () => ({
      handleOutVarRenameChange: (...args: unknown[]) => mockHandleOutVarRenameChange(...args),
      isVarUsedInNodes: (...args: unknown[]) => mockIsVarUsedInNodes(...args),
      removeUsedVarInNodes: (...args: unknown[]) => mockRemoveUsedVarInNodes(...args),
    }),
  }
})

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
  __esModule: true,
  default: () => ({
    deleteInspectVar: (...args: unknown[]) => mockDeleteInspectVar(...args),
    renameInspectVarName: (...args: unknown[]) => mockRenameInspectVarName(...args),
    nodesWithInspectVars: inspectState.nodesWithInspectVars,
  }),
}))

const createPayload = (overrides: Partial<CodeNodeType> = {}): CodeNodeType =>
  ({
    title: 'Code',
    desc: '',
    type: BlockEnum.Code,
    code: 'def main():\n    return "ok"',
    code_language: CodeLanguage.python3,
    variables: [],
    outputs: {
      primary: { type: VarType.string, children: null },
      secondary: { type: VarType.number, children: null },
    },
    ...overrides,
  }) as CodeNodeType

const renderUseOutputVarList = (
  payload: CodeNodeType = createPayload(),
  outputKeyOrders: string[] = Object.keys(payload.outputs),
) =>
  renderHook(() =>
    useOutputVarList<CodeNodeType>({
      id: 'code-node',
      inputs: payload,
      setInputs: mockSetInputs,
      outputKeyOrders,
      onOutputKeyOrdersChange: mockOnOutputKeyOrdersChange,
    }),
  )

describe('useOutputVarList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
    inspectState.nodesWithInspectVars = [
      {
        nodeId: 'code-node',
        vars: [
          { id: 'inspect-primary', name: 'primary' },
          { id: 'inspect-secondary', name: 'secondary' },
        ],
      },
    ]
  })

  it('removes the row right away when no other node uses the variable', () => {
    const { result } = renderUseOutputVarList()

    act(() => {
      result.current.handleRemoveVariable(0)
    })

    expect(result.current.isShowRemoveVarConfirm).toBe(false)
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { secondary: { type: VarType.number, children: null } },
      }),
    )
    expect(mockOnOutputKeyOrdersChange).toHaveBeenCalledWith(['secondary'])
    expect(mockRemoveUsedVarInNodes).not.toHaveBeenCalled()
    expect(mockDeleteInspectVar).toHaveBeenCalledWith('code-node', 'inspect-primary')
  })

  it('removes the row after the confirmation when other nodes use the variable', () => {
    mockIsVarUsedInNodes.mockReturnValue(true)
    const { result } = renderUseOutputVarList()

    act(() => {
      result.current.handleRemoveVariable(0)
    })

    expect(result.current.isShowRemoveVarConfirm).toBe(true)
    // only ask first, the row is still there
    expect(mockSetInputs).not.toHaveBeenCalled()

    act(() => {
      result.current.onRemoveVarConfirm()
    })

    expect(mockRemoveUsedVarInNodes).toHaveBeenCalledWith(['code-node', 'primary'])
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { secondary: { type: VarType.number, children: null } },
      }),
    )
    expect(mockOnOutputKeyOrdersChange).toHaveBeenCalledWith(['secondary'])
    expect(mockDeleteInspectVar).toHaveBeenCalledWith('code-node', 'inspect-primary')
    expect(result.current.isShowRemoveVarConfirm).toBe(false)
  })

  it('removes the confirmed row by its own index, not by the shared name', () => {
    mockIsVarUsedInNodes.mockReturnValue(true)
    const { result } = renderUseOutputVarList()

    act(() => {
      result.current.handleRemoveVariable(1)
    })
    act(() => {
      result.current.onRemoveVarConfirm()
    })

    expect(mockRemoveUsedVarInNodes).toHaveBeenCalledWith(['code-node', 'secondary'])
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { primary: { type: VarType.string, children: null } },
      }),
    )
    expect(mockOnOutputKeyOrdersChange).toHaveBeenCalledWith(['primary'])
  })

  it('keeps the row when the confirmation is cancelled', () => {
    mockIsVarUsedInNodes.mockReturnValue(true)
    const { result } = renderUseOutputVarList()

    act(() => {
      result.current.handleRemoveVariable(0)
    })
    act(() => {
      result.current.hideRemoveVarConfirm()
    })

    expect(result.current.isShowRemoveVarConfirm).toBe(false)
    expect(mockSetInputs).not.toHaveBeenCalled()
    expect(mockOnOutputKeyOrdersChange).not.toHaveBeenCalled()
    expect(mockRemoveUsedVarInNodes).not.toHaveBeenCalled()
  })

  it('keeps the output entry when another row still shares the removed name', () => {
    mockIsVarUsedInNodes.mockReturnValue(true)
    const payload = createPayload({
      outputs: { primary: { type: VarType.string, children: null } },
    })
    const { result } = renderUseOutputVarList(payload, ['primary', 'primary'])

    act(() => {
      result.current.handleRemoveVariable(0)
    })
    act(() => {
      result.current.onRemoveVarConfirm()
    })

    expect(mockOnOutputKeyOrdersChange).toHaveBeenCalledWith(['primary'])
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { primary: { type: VarType.string, children: null } },
      }),
    )
    expect(mockDeleteInspectVar).not.toHaveBeenCalled()
  })

  it('recomputes the default value after a confirmed removal', () => {
    mockIsVarUsedInNodes.mockReturnValue(true)
    const payload = createPayload({ error_strategy: ErrorHandleTypeEnum.defaultValue })
    const { result } = renderUseOutputVarList(payload)

    act(() => {
      result.current.handleRemoveVariable(1)
    })
    act(() => {
      result.current.onRemoveVarConfirm()
    })

    const lastInputs = mockSetInputs.mock.calls.at(-1)![0] as CodeNodeType
    expect(lastInputs.default_value).toEqual([{ key: 'primary', type: VarType.string, value: '' }])
  })

  it('keeps the configured fallbacks of the outputs that stay behind a confirmed removal', () => {
    mockIsVarUsedInNodes.mockReturnValue(true)
    const payload = createPayload({
      error_strategy: ErrorHandleTypeEnum.defaultValue,
      default_value: [
        { key: 'primary', type: VarType.string, value: 'sentinel' },
        { key: 'secondary', type: VarType.number, value: 7 },
      ],
    })
    const { result } = renderUseOutputVarList(payload)

    act(() => {
      result.current.handleRemoveVariable(1)
    })
    act(() => {
      result.current.onRemoveVarConfirm()
    })

    const lastInputs = mockSetInputs.mock.calls.at(-1)![0] as CodeNodeType
    expect(lastInputs.default_value).toEqual([
      { key: 'primary', type: VarType.string, value: 'sentinel' },
    ])
  })

  it('keeps the configured fallbacks of the outputs that stay behind a direct removal', () => {
    const payload = createPayload({
      error_strategy: ErrorHandleTypeEnum.defaultValue,
      default_value: [
        { key: 'primary', type: VarType.string, value: 'sentinel' },
        { key: 'secondary', type: VarType.number, value: 7 },
      ],
    })
    const { result } = renderUseOutputVarList(payload)

    act(() => {
      result.current.handleRemoveVariable(1)
    })

    const lastInputs = mockSetInputs.mock.calls.at(-1)![0] as CodeNodeType
    expect(lastInputs.default_value).toEqual([
      { key: 'primary', type: VarType.string, value: 'sentinel' },
    ])
  })

  it('keeps the configured fallbacks when another output is added', () => {
    const payload = createPayload({
      error_strategy: ErrorHandleTypeEnum.defaultValue,
      default_value: [
        { key: 'primary', type: VarType.string, value: 'sentinel' },
        { key: 'secondary', type: VarType.number, value: 7 },
      ],
    })
    const { result } = renderUseOutputVarList(payload)

    act(() => {
      result.current.handleAddVariable()
    })

    const lastInputs = mockSetInputs.mock.calls.at(-1)![0] as CodeNodeType
    expect(lastInputs.default_value).toEqual([
      { key: 'primary', type: VarType.string, value: 'sentinel' },
      { key: 'secondary', type: VarType.number, value: 7 },
      { key: 'var_3', type: VarType.string, value: '' },
    ])
  })

  it('carries the configured fallback over to the new name of a renamed output', () => {
    const payload = createPayload({
      error_strategy: ErrorHandleTypeEnum.defaultValue,
      default_value: [
        { key: 'primary', type: VarType.string, value: 'sentinel' },
        { key: 'secondary', type: VarType.number, value: 7 },
      ],
    })
    const { result } = renderUseOutputVarList(payload)

    act(() => {
      result.current.handleVarsChange(
        {
          renamed: { type: VarType.string, children: null },
          secondary: { type: VarType.number, children: null },
        },
        0,
        'renamed',
      )
    })

    const lastInputs = mockSetInputs.mock.calls.at(-1)![0] as CodeNodeType
    expect(lastInputs.default_value).toEqual([
      { key: 'renamed', type: VarType.string, value: 'sentinel' },
      { key: 'secondary', type: VarType.number, value: 7 },
    ])
  })

  it('only resets the fallback of the output whose type changed', () => {
    const payload = createPayload({
      error_strategy: ErrorHandleTypeEnum.defaultValue,
      default_value: [
        { key: 'primary', type: VarType.string, value: 'sentinel' },
        { key: 'secondary', type: VarType.number, value: 7 },
      ],
    })
    const { result } = renderUseOutputVarList(payload)

    act(() => {
      result.current.handleVarsChange({
        primary: { type: VarType.number, children: null },
        secondary: { type: VarType.number, children: null },
      })
    })

    const lastInputs = mockSetInputs.mock.calls.at(-1)![0] as CodeNodeType
    expect(lastInputs.default_value).toEqual([
      { key: 'primary', type: VarType.number, value: 0 },
      { key: 'secondary', type: VarType.number, value: 7 },
    ])
  })

  it('does not touch the fallbacks when the error strategy is not default-value', () => {
    const payload = createPayload({
      error_strategy: ErrorHandleTypeEnum.failBranch,
      default_value: [{ key: 'primary', type: VarType.string, value: 'sentinel' }],
    })
    const { result } = renderUseOutputVarList(payload)

    act(() => {
      result.current.handleRemoveVariable(1)
    })

    const lastInputs = mockSetInputs.mock.calls.at(-1)![0] as CodeNodeType
    expect(lastInputs.default_value).toEqual([
      { key: 'primary', type: VarType.string, value: 'sentinel' },
    ])
  })
})
