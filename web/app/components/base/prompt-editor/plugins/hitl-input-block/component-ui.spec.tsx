import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import HITLInputComponentUI from './component-ui'

type InputFieldMockProps = {
  nodeId: string
  isEdit: boolean
  payload?: FormInputItem
  onChange: (newPayload: FormInputItem) => void
  onCancel: () => void
}

type VariableBlockMockProps = {
  variables: ValueSelector
  workflowNodesMap: Record<string, unknown>
  getVarType?: (payload: {
    nodeId: string
    valueSelector: ValueSelector
  }) => unknown
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
}

const { mockInputFieldProps, mockVariableBlockProps } = vi.hoisted(() => ({
  mockInputFieldProps: vi.fn<(props: InputFieldMockProps) => void>(),
  mockVariableBlockProps: vi.fn<(props: VariableBlockMockProps) => void>(),
}))

vi.mock('./input-field', () => ({
  default: (props: InputFieldMockProps) => {
    mockInputFieldProps(props)

    const payload = props.payload ?? {
      type: InputVarType.paragraph,
      output_variable_name: '',
      default: {
        type: 'constant' as const,
        selector: [],
        value: '',
      },
    }

    const renamedPayload: FormInputItem = {
      ...payload,
      output_variable_name: `${payload.output_variable_name}_renamed`,
    }

    return (
      <div data-testid="mock-input-field">
        <button type="button" onClick={() => props.onChange(payload)}>apply-same</button>
        <button type="button" onClick={() => props.onChange(renamedPayload)}>apply-rename</button>
        <button type="button" onClick={props.onCancel}>cancel-edit</button>
      </div>
    )
  },
}))

vi.mock('./variable-block', () => ({
  default: (props: VariableBlockMockProps) => {
    mockVariableBlockProps(props)
    return (
      <div data-testid="mock-variable-block">
        {props.variables.join('.')}
      </div>
    )
  },
}))

const createFormInput = (overrides?: Partial<FormInputItem>): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'customer_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'John Doe',
  },
  ...overrides,
})

const getActionButtons = (container: HTMLElement) => {
  return Array.from(container.querySelectorAll('button.action-btn')) as HTMLButtonElement[]
}

describe('HITLInputComponentUI', () => {
  const nodeId = 'node-1'
  const varName = 'customer_name'
  const workflowNodesMap = {
    'node-2': {
      title: 'Node 2',
      type: BlockEnum.LLM,
    },
  }

  const renderComponent = (props?: Partial<React.ComponentProps<typeof HITLInputComponentUI>>) => {
    const onChange = vi.fn()
    const onRename = vi.fn()
    const onRemove = vi.fn()

    const utils = render(
      <HITLInputComponentUI
        nodeId={nodeId}
        varName={varName}
        onChange={onChange}
        onRename={onRename}
        onRemove={onRemove}
        workflowNodesMap={workflowNodesMap}
        formInput={createFormInput()}
        {...props}
      />,
    )

    return {
      ...utils,
      onChange,
      onRename,
      onRemove,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Render basic variable info with constant default value.
  describe('Rendering', () => {
    it('should render var name and constant default value', () => {
      const { container } = renderComponent()

      expect(screen.getByText(varName)).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-variable-block')).not.toBeInTheDocument()
      expect(getActionButtons(container)).toHaveLength(2)
    })

    it('should render variable block when default type is variable', () => {
      const selector = ['node-2', 'answer'] as ValueSelector

      renderComponent({
        formInput: createFormInput({
          default: {
            type: 'variable',
            selector,
            value: '',
          },
        }),
      })

      expect(screen.getByTestId('mock-variable-block')).toHaveTextContent('node-2.answer')
      expect(mockVariableBlockProps).toHaveBeenCalledWith(expect.objectContaining({
        variables: selector,
        workflowNodesMap,
      }))
    })

    it('should hide action buttons when readonly is true', () => {
      const { container } = renderComponent({ readonly: true })

      expect(getActionButtons(container)).toHaveLength(0)
    })
  })

  // Remove handler should be triggered from lexical-style native click listener.
  describe('Remove action', () => {
    it('should call onRemove with current var name when remove button is clicked', async () => {
      const { container, onRemove } = renderComponent()
      const buttons = getActionButtons(container)

      await userEvent.click(buttons[1])

      expect(onRemove).toHaveBeenCalledWith(varName)
      expect(onRemove).toHaveBeenCalledTimes(1)
    })
  })

  // Edit flow should route to onChange or onRename based on output variable name.
  describe('Edit flow', () => {
    it('should call onChange and close modal when edited name is unchanged', async () => {
      const { container, onChange, onRename } = renderComponent()
      const buttons = getActionButtons(container)

      await userEvent.click(buttons[0])
      expect(await screen.findByTestId('mock-input-field')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'apply-same' }))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        output_variable_name: varName,
      }))
      expect(onRename).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(screen.queryByTestId('mock-input-field')).not.toBeInTheDocument()
      })
    })

    it('should call onRename and close modal when edited name changes', async () => {
      const { container, onChange, onRename } = renderComponent()
      const buttons = getActionButtons(container)

      await userEvent.click(buttons[0])
      expect(await screen.findByTestId('mock-input-field')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'apply-rename' }))

      expect(onChange).not.toHaveBeenCalled()
      expect(onRename).toHaveBeenCalledWith(expect.objectContaining({
        output_variable_name: `${varName}_renamed`,
      }), varName)

      await waitFor(() => {
        expect(screen.queryByTestId('mock-input-field')).not.toBeInTheDocument()
      })
    })

    it('should close modal without update when cancel is clicked', async () => {
      const { container, onChange, onRename } = renderComponent()
      const buttons = getActionButtons(container)

      await userEvent.click(buttons[0])
      expect(await screen.findByTestId('mock-input-field')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'cancel-edit' }))

      expect(onChange).not.toHaveBeenCalled()
      expect(onRename).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(screen.queryByTestId('mock-input-field')).not.toBeInTheDocument()
      })
    })
  })

  // Missing formInput should use component default payload derived from varName.
  describe('Default formInput', () => {
    it('should pass default payload to InputField when formInput is undefined', async () => {
      const { container } = renderComponent({ formInput: undefined })
      const buttons = getActionButtons(container)

      await userEvent.click(buttons[0])
      expect(await screen.findByTestId('mock-input-field')).toBeInTheDocument()

      const call = mockInputFieldProps.mock.calls.at(-1)?.[0]
      expect(call).toEqual(expect.objectContaining({
        nodeId,
        isEdit: true,
        payload: expect.objectContaining({
          type: InputVarType.paragraph,
          output_variable_name: varName,
          default: expect.objectContaining({
            type: 'constant',
            value: '',
          }),
        }),
      }))
    })
  })
})
