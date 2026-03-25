import type { DeliveryMethod, HumanInputNodeType, UserAction } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const mockUseUpdateNodeInternals = vi.hoisted(() => vi.fn())
const mockUseNodesReadOnly = vi.hoisted(() => vi.fn())
const mockUseEdgesInteractions = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockUseFormContent = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  useUpdateNodeInternals: () => mockUseUpdateNodeInternals(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

vi.mock('@/app/components/workflow/hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => mockUseEdgesInteractions(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('../use-form-content', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseFormContent(...args),
}))

const createPayload = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [{
    id: 'webapp',
    type: 'webapp',
    enabled: true,
  } as DeliveryMethod],
  form_content: 'Body',
  inputs: [],
  user_actions: [{
    id: 'approve',
    title: 'Approve',
    button_style: 'primary',
  } as UserAction],
  timeout: 3,
  timeout_unit: 'day',
  ...overrides,
})

describe('human-input/hooks/use-config', () => {
  const mockSetInputs = vi.fn()
  const mockHandleEdgeDeleteByDeleteBranch = vi.fn()
  const mockHandleEdgeSourceHandleChange = vi.fn()
  const mockUpdateNodeInternals = vi.fn()
  const formContentHook = {
    editorKey: 3,
    handleFormContentChange: vi.fn(),
    handleFormInputsChange: vi.fn(),
    handleFormInputItemRename: vi.fn(),
    handleFormInputItemRemove: vi.fn(),
  }
  let currentInputs = createPayload()

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()
    mockUseUpdateNodeInternals.mockReturnValue(mockUpdateNodeInternals)
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    mockUseEdgesInteractions.mockReturnValue({
      handleEdgeDeleteByDeleteBranch: mockHandleEdgeDeleteByDeleteBranch,
      handleEdgeSourceHandleChange: mockHandleEdgeSourceHandleChange,
    })
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    }))
    mockUseFormContent.mockReturnValue(formContentHook)
  })

  it('should expose form-content helpers and update delivery methods, timeout, and collapsed state', () => {
    const { result } = renderHook(() => useConfig('human-input-node', currentInputs))
    const methods = [{
      id: 'email',
      type: 'email',
      enabled: true,
    } as DeliveryMethod]

    expect(result.current.editorKey).toBe(3)
    expect(result.current.readOnly).toBe(false)
    expect(result.current.structuredOutputCollapsed).toBe(true)

    act(() => {
      result.current.handleDeliveryMethodChange(methods)
      result.current.handleTimeoutChange({ timeout: 12, unit: 'hour' })
      result.current.setStructuredOutputCollapsed(false)
    })

    expect(mockSetInputs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      delivery_methods: methods,
    }))
    expect(mockSetInputs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      timeout: 12,
      timeout_unit: 'hour',
    }))
    expect(result.current.structuredOutputCollapsed).toBe(false)
  })

  it('should append and delete user actions while syncing branch-edge cleanup', () => {
    const { result } = renderHook(() => useConfig('human-input-node', currentInputs))
    const newAction = {
      id: 'reject',
      title: 'Reject',
      button_style: 'default',
    } as UserAction

    act(() => {
      result.current.handleUserActionAdd(newAction)
      result.current.handleUserActionDelete('approve')
    })

    expect(mockSetInputs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      user_actions: [
        expect.objectContaining({ id: 'approve' }),
        newAction,
      ],
    }))
    expect(mockSetInputs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      user_actions: [],
    }))
    expect(mockHandleEdgeDeleteByDeleteBranch).toHaveBeenCalledWith('human-input-node', 'approve')
  })

  it('should update user action ids and refresh source handles when the branch key changes', () => {
    const { result } = renderHook(() => useConfig('human-input-node', currentInputs))
    const renamedAction = {
      id: 'approved',
      title: 'Approve',
      button_style: 'primary',
    } as UserAction

    act(() => {
      result.current.handleUserActionChange(0, renamedAction)
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      user_actions: [renamedAction],
    }))
    expect(mockHandleEdgeSourceHandleChange).toHaveBeenCalledWith('human-input-node', 'approve', 'approved')
    expect(mockUpdateNodeInternals).toHaveBeenCalledWith('human-input-node')
  })
})
