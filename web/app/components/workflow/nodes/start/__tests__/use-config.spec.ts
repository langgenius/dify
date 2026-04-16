import type { StartNodeType } from '../types'
import type { InputVar, ValueSelector } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, ChangeType, InputVarType } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseNodesReadOnly = vi.hoisted(() => vi.fn())
const mockUseWorkflow = vi.hoisted(() => vi.fn())
const mockUseIsChatMode = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockUseInspectVarsCrud = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
  useWorkflow: () => mockUseWorkflow(),
  useIsChatMode: () => mockUseIsChatMode(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseInspectVarsCrud(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  __esModule: true,
  toast: {
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Question',
  variable: 'query',
  type: InputVarType.textInput,
  required: true,
  ...overrides,
})

const createPayload = (overrides: Partial<StartNodeType> = {}): StartNodeType => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
  variables: [
    createInputVar(),
    createInputVar({
      label: 'Age',
      variable: 'age',
      type: InputVarType.number,
      required: false,
    }),
  ],
  ...overrides,
})

describe('start/use-config', () => {
  const mockSetInputs = vi.fn()
  const mockHandleOutVarRenameChange = vi.fn()
  const mockIsVarUsedInNodes = vi.fn()
  const mockRemoveUsedVarInNodes = vi.fn()
  const mockDeleteNodeInspectorVars = vi.fn()
  const mockRenameInspectVarName = vi.fn()
  const mockDeleteInspectVar = vi.fn()
  const toastSpy = mockNotify
  let currentInputs: StartNodeType

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()

    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    mockUseWorkflow.mockReturnValue({
      handleOutVarRenameChange: mockHandleOutVarRenameChange,
      isVarUsedInNodes: mockIsVarUsedInNodes,
      removeUsedVarInNodes: mockRemoveUsedVarInNodes,
    })
    mockUseIsChatMode.mockReturnValue(false)
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    }))
    mockUseInspectVarsCrud.mockReturnValue({
      deleteNodeInspectorVars: mockDeleteNodeInspectorVars,
      renameInspectVarName: mockRenameInspectVarName,
      nodesWithInspectVars: [{
        nodeId: 'start-node',
        vars: [{ id: 'inspect-query', name: 'query' }],
      }],
      deleteInspectVar: mockDeleteInspectVar,
    })
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  it('should rename variables and sync downstream variable references', () => {
    const { result } = renderHook(() => useConfig('start-node', currentInputs))
    const renamedList = [
      createInputVar({
        label: 'Question',
        variable: 'prompt',
      }),
      createInputVar({
        label: 'Age',
        variable: 'age',
        type: InputVarType.number,
        required: false,
      }),
    ]

    act(() => {
      result.current.handleVarListChange(renamedList, {
        index: 0,
        payload: {
          type: ChangeType.changeVarName,
          payload: {
            beforeKey: 'query',
          },
        },
      })
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variables: renamedList,
    }))
    expect(mockHandleOutVarRenameChange).toHaveBeenCalledWith('start-node', ['start-node', 'query'], ['start-node', 'prompt'])
    expect(mockRenameInspectVarName).toHaveBeenCalledWith('start-node', 'query', 'prompt')
    expect(result.current.readOnly).toBe(false)
    expect(result.current.isChatMode).toBe(false)
  })

  it('should block removal when the variable is still in use and confirm the deletion later', () => {
    mockIsVarUsedInNodes.mockReturnValue(true)
    const { result } = renderHook(() => useConfig('start-node', currentInputs))
    const nextList = [currentInputs.variables[1]!]

    act(() => {
      result.current.handleVarListChange(nextList, {
        index: 0,
        payload: {
          type: ChangeType.remove,
          payload: {
            beforeKey: 'query',
          },
        },
      })
    })

    expect(mockDeleteInspectVar).toHaveBeenCalledWith('start-node', 'inspect-query')
    expect(mockSetInputs).not.toHaveBeenCalled()
    expect(result.current.isShowRemoveVarConfirm).toBe(true)

    act(() => {
      result.current.onRemoveVarConfirm()
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variables: [expect.objectContaining({ variable: 'age' })],
    }))
    expect(mockRemoveUsedVarInNodes).toHaveBeenCalledWith(['start-node', 'query'] as ValueSelector)
    expect(result.current.isShowRemoveVarConfirm).toBe(false)
  })

  it('should validate duplicate variables and labels before adding a new variable', () => {
    const { result } = renderHook(() => useConfig('start-node', currentInputs))

    let added = true
    act(() => {
      added = result.current.handleAddVariable(createInputVar({
        label: 'Different Label',
        variable: 'query',
      }))
    })

    expect(added).toBe(false)
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'varKeyError.keyAlreadyExists',
    }))

    mockSetInputs.mockClear()
    let addedUnique = false
    act(() => {
      addedUnique = result.current.handleAddVariable(createInputVar({
        label: 'Locale',
        variable: 'locale',
        required: false,
      }))
    })

    expect(addedUnique).toBe(true)
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.arrayContaining([
        expect.objectContaining({ variable: 'locale' }),
      ]),
    }))
  })

  it('should clear inspector vars for non-remove list updates and reject duplicate labels', () => {
    const { result } = renderHook(() => useConfig('start-node', currentInputs))
    const typeEditedList = [
      createInputVar({
        label: 'Question',
        variable: 'query',
        type: InputVarType.paragraph,
      }),
      currentInputs.variables[1]!,
    ]

    act(() => {
      result.current.handleVarListChange(typeEditedList)
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variables: typeEditedList,
    }))
    expect(mockDeleteNodeInspectorVars).toHaveBeenCalledWith('start-node')

    toastSpy.mockClear()
    let added = true
    act(() => {
      added = result.current.handleAddVariable(createInputVar({
        label: 'Age',
        variable: 'new_age',
      }))
    })

    expect(added).toBe(false)
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'varKeyError.keyAlreadyExists',
    }))
  })
})
