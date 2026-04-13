import type { AnswerNodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const mockUseNodesReadOnly = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockUseVarList = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-var-list', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseVarList(...args),
}))

const createPayload = (overrides: Partial<AnswerNodeType> = {}): AnswerNodeType => ({
  title: 'Answer',
  desc: '',
  type: BlockEnum.Answer,
  variables: [],
  answer: 'Initial answer',
  ...overrides,
})

describe('answer/use-config', () => {
  const mockSetInputs = vi.fn()
  const mockHandleVarListChange = vi.fn()
  const mockHandleAddVariable = vi.fn()
  let currentInputs: AnswerNodeType

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()

    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    mockUseNodeCrud.mockReturnValue({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    })
    mockUseVarList.mockReturnValue({
      handleVarListChange: mockHandleVarListChange,
      handleAddVariable: mockHandleAddVariable,
    })
  })

  it('should update the answer text and expose var-list handlers', () => {
    const { result } = renderHook(() => useConfig('answer-node', currentInputs))

    act(() => {
      result.current.handleAnswerChange('Updated answer')
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      answer: 'Updated answer',
    }))
    expect(result.current.handleVarListChange).toBe(mockHandleVarListChange)
    expect(result.current.handleAddVariable).toBe(mockHandleAddVariable)
    expect(result.current.readOnly).toBe(false)
  })

  it('should filter out array-object variables from the prompt editor picker', () => {
    const { result } = renderHook(() => useConfig('answer-node', currentInputs))

    expect(result.current.filterVar({
      variable: 'items',
      type: VarType.arrayObject,
    })).toBe(false)
    expect(result.current.filterVar({
      variable: 'message',
      type: VarType.string,
    })).toBe(true)
  })
})
