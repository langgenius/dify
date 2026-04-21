import type { FormInputItem, HumanInputNodeType } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useFormContent from '../use-form-content'

const mockUseWorkflow = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflow: () => mockUseWorkflow(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

const createFormInput = (overrides: Partial<FormInputItem> = {}): FormInputItem => ({
  type: InputVarType.textInput,
  output_variable_name: 'old_name',
  default: {
    selector: [],
    type: 'constant',
    value: '',
  },
  ...overrides,
})

const createPayload = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [],
  form_content: 'Hello {{#$output.old_name#}}',
  inputs: [createFormInput()],
  user_actions: [],
  timeout: 1,
  timeout_unit: 'day',
  ...overrides,
})

describe('human-input/use-form-content', () => {
  const mockSetInputs = vi.fn()
  const mockHandleOutVarRenameChange = vi.fn()
  let currentInputs = createPayload()

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()
    mockUseWorkflow.mockReturnValue({
      handleOutVarRenameChange: mockHandleOutVarRenameChange,
    })
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    }))
  })

  it('should update raw form content and replace the form input list', () => {
    const { result } = renderHook(() => useFormContent('human-input-node', currentInputs))
    const nextInputs = [
      createFormInput({
        output_variable_name: 'approval',
      }),
    ]

    act(() => {
      result.current.handleFormContentChange('Updated body')
      result.current.handleFormInputsChange(nextInputs)
    })

    expect(mockSetInputs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      form_content: 'Updated body',
    }))
    expect(mockSetInputs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      inputs: nextInputs,
    }))
    expect(result.current.editorKey).toBe(1)
  })

  it('should rename input placeholders inside markdown and notify downstream references', () => {
    const { result } = renderHook(() => useFormContent('human-input-node', currentInputs))
    const renamedInput = createFormInput({
      output_variable_name: 'new_name',
    })

    act(() => {
      result.current.handleFormInputItemRename(renamedInput, 'old_name')
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      form_content: 'Hello {{#$output.new_name#}}',
      inputs: [renamedInput],
    }))
    expect(mockHandleOutVarRenameChange).toHaveBeenCalledWith('human-input-node', ['human-input-node', 'old_name'], ['human-input-node', 'new_name'])
    expect(result.current.editorKey).toBe(1)
  })

  it('should remove an input placeholder and its form input metadata', () => {
    const { result } = renderHook(() => useFormContent('human-input-node', currentInputs))

    act(() => {
      result.current.handleFormInputItemRemove('old_name')
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      form_content: 'Hello ',
      inputs: [],
    }))
    expect(result.current.editorKey).toBe(1)
  })
})
