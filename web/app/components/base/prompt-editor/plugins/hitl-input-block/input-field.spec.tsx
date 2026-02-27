import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import InputField from './input-field'

type VarReferencePickerProps = {
  onChange: (value: string[]) => void
}

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: (props: VarReferencePickerProps) => {
    return (
      <button type="button" onClick={() => props.onChange(['node-a', 'var-a'])}>
        pick-variable
      </button>
    )
  },
}))

const createPayload = (overrides?: Partial<FormInputItem>): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'valid_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'hello',
  },
  ...overrides,
})

describe('InputField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should disable save and show validation error when variable name is invalid', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-1"
        isEdit
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    await user.clear(inputs[0])
    await user.type(inputs[0], 'invalid name')

    expect(screen.getByText('workflow.nodes.humanInput.insertInputField.variableNameInvalid')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should call onChange when saving a valid payload in edit mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-2"
        isEdit
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual(createPayload())
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <InputField
        nodeId="node-3"
        isEdit={false}
        payload={createPayload()}
        onChange={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should use default payload when payload is not provided', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-default-payload"
        isEdit={false}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const nameInput = screen.getAllByRole('textbox')[0]
    await user.type(nameInput, 'generated_name')
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual({
      type: InputVarType.paragraph,
      output_variable_name: 'generated_name',
      default: {
        type: 'constant',
        selector: [],
        value: '',
      },
    })
  })

  it('should save in create mode on Ctrl+Enter and include updated default constant value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-4"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'constant',
            selector: [],
            value: '',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.keyboard('{Tab}')
    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[1], 'constant-default')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].default).toEqual({
      type: 'constant',
      selector: [],
      value: 'constant-default',
    })
  })

  it('should switch to variable mode when type switch is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-4-1"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'constant',
            selector: [],
            value: 'preset',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.useVarInstead/i))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].default.type).toBe('variable')
  })

  it('should switch to constant mode when variable mode type switch is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-5-1"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'variable',
            selector: ['node-y', 'var-y'],
            value: '',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.useConstantInstead/i))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].default.type).toBe('constant')
  })

  it('should update default selector when variable picker is used', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-5"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'variable',
            selector: ['node-x', 'old'],
            value: '',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByText('pick-variable'))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].default).toEqual({
      type: 'variable',
      selector: ['node-a', 'var-a'],
      value: '',
    })
  })

  it('should initialize default config when missing and selector is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const payloadWithoutDefault = {
      ...createPayload(),
      default: undefined,
    } as unknown as FormInputItem

    render(
      <InputField
        nodeId="node-6"
        isEdit={false}
        payload={payloadWithoutDefault}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.keyboard('{Tab}')
    await user.click(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.useVarInstead/i))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].default).toEqual({
      type: 'variable',
      selector: [],
      value: '',
    })
  })
})
