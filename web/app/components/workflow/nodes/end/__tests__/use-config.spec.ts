import type { EndNodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
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

const createPayload = (overrides: Partial<EndNodeType> = {}): EndNodeType => ({
  title: 'End',
  desc: '',
  type: BlockEnum.End,
  outputs: [],
  ...overrides,
})

describe('end/use-config', () => {
  const mockHandleVarListChange = vi.fn()
  const mockHandleAddVariable = vi.fn()
  const mockSetInputs = vi.fn()
  let currentInputs: EndNodeType

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()

    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true })
    mockUseNodeCrud.mockReturnValue({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    })
    mockUseVarList.mockReturnValue({
      handleVarListChange: mockHandleVarListChange,
      handleAddVariable: mockHandleAddVariable,
    })
  })

  it('should build var-list handlers against outputs and surface the readonly state', () => {
    const { result } = renderHook(() => useConfig('end-node', currentInputs))
    const config = mockUseVarList.mock.calls[0]![0] as { setInputs: (inputs: EndNodeType) => void }

    expect(mockUseVarList).toHaveBeenCalledWith(expect.objectContaining({
      inputs: currentInputs,
      setInputs: expect.any(Function),
      varKey: 'outputs',
    }))
    expect(result.current.readOnly).toBe(true)
    expect(result.current.handleVarListChange).toBe(mockHandleVarListChange)
    expect(result.current.handleAddVariable).toBe(mockHandleAddVariable)

    act(() => {
      config.setInputs(createPayload({
        outputs: currentInputs.outputs,
      }))
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      outputs: currentInputs.outputs,
    }))
  })
})
