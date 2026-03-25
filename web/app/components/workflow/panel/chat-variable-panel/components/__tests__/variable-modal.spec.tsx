import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { toast } from '@/app/components/base/ui/toast'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '../../type'
import VariableModal from '../variable-modal'

vi.mock('uuid', () => ({
  v4: () => 'generated-id',
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

const renderVariableModal = (props?: Partial<React.ComponentProps<typeof VariableModal>>) => {
  const onClose = vi.fn()
  const onSave = vi.fn()

  const result = renderWorkflowComponent(
    React.createElement(
      VariableModal,
      {
        onClose,
        onSave,
        ...props,
      },
    ),
  )

  return { ...result, onClose, onSave }
}

describe('variable-modal', () => {
  const mockToastError = vi.mocked(toast.error)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a new string variable and close after saving', async () => {
    const user = userEvent.setup()
    const { onClose, onSave } = renderVariableModal()

    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder'), 'greeting')
    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.valuePlaceholder'), 'hello')
    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.descriptionPlaceholder'), 'demo variable')
    await user.click(screen.getByText('common.operation.save'))

    expect(onSave).toHaveBeenCalledWith({
      id: 'generated-id',
      name: 'greeting',
      value_type: ChatVarType.String,
      value: 'hello',
      description: 'demo variable',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('should reject duplicate variable names from the workflow store', async () => {
    const user = userEvent.setup()
    const { onSave, store } = renderVariableModal()

    store.setState({
      conversationVariables: [{
        id: 'var-1',
        name: 'existing_name',
        description: '',
        value_type: ChatVarType.String,
        value: '',
      }],
    })

    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder'), 'existing_name')
    await user.click(screen.getByText('common.operation.save'))

    expect(mockToastError.mock.calls.at(-1)?.[0]).toBe('name is existed')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should load an existing object variable and save object values edited in form mode', async () => {
    const user = userEvent.setup()
    const { onSave } = renderVariableModal({
      chatVar: {
        id: 'var-2',
        name: 'config',
        description: 'settings',
        value_type: ChatVarType.Object,
        value: { apiKey: 'secret', timeout: 30 },
      },
    })

    expect(screen.getByDisplayValue('config')).toBeInTheDocument()
    expect(screen.getByDisplayValue('secret')).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()

    await user.clear(screen.getByDisplayValue('secret'))
    await user.type(screen.getByDisplayValue('30'), '5')
    await user.click(screen.getByText('common.operation.save'))

    expect(onSave).toHaveBeenCalledWith({
      id: 'var-2',
      name: 'config',
      value_type: ChatVarType.Object,
      value: {
        apiKey: null,
        timeout: 305,
      },
      description: 'settings',
    })
  })

  it('should switch types and use default values for boolean arrays', async () => {
    const user = userEvent.setup()
    const { onSave } = renderVariableModal()

    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder'), 'flags')
    await user.click(screen.getByText('string'))
    await user.click(screen.getByText('array[boolean]'))
    await user.click(screen.getByText('common.operation.save'))

    expect(onSave).toHaveBeenCalledWith({
      id: 'generated-id',
      name: 'flags',
      value_type: ChatVarType.ArrayBoolean,
      value: [false],
      description: '',
    })
  })

  it('should toggle object editing modes without changing behavior', async () => {
    const user = userEvent.setup()
    renderVariableModal({
      chatVar: {
        id: 'var-3',
        name: 'payload',
        description: '',
        value_type: ChatVarType.Object,
        value: { enabled: 1 },
      },
    })

    await user.click(screen.getByText('workflow.chatVariable.modal.editInJSON'))
    await waitFor(() => {
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
    await user.click(screen.getByText('workflow.chatVariable.modal.editInForm'))
    expect(screen.getByDisplayValue('enabled')).toBeInTheDocument()
  })

  it('should validate variable names on blur and preserve underscore replacement', () => {
    renderVariableModal()
    const input = screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder')

    fireEvent.change(input, { target: { value: 'bad name' } })
    fireEvent.blur(input)

    expect((input as HTMLInputElement).value).toBe('bad_name')
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('should stop invalid variable names before they are stored in local state', async () => {
    const { onSave } = renderVariableModal()
    const input = screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder') as HTMLInputElement

    fireEvent.change(input, { target: { value: '1bad' } })
    await userEvent.click(screen.getByText('common.operation.save'))

    expect(input.value).toBe('')
    expect(mockToastError).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should edit number variables through the value input', async () => {
    const user = userEvent.setup()
    const { onSave } = renderVariableModal()

    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder'), 'timeout')
    await user.click(screen.getByText('string'))
    await user.click(screen.getByText('number'))
    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.valuePlaceholder'), '3')
    await user.click(screen.getByText('common.operation.save'))

    expect(onSave).toHaveBeenCalledWith({
      id: 'generated-id',
      name: 'timeout',
      value_type: ChatVarType.Number,
      value: 3,
      description: '',
    })
  })
})
