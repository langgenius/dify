import type { ParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType, SupportUploadFileTypes, VarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import InputField from '../input-field'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: i18next } = await import('i18next')
  const i18n = i18next.createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: {
      'en-US': {
        workflowHumanInput: {
          nodes: {
            humanInput: {
              insertInputField: {
                prePopulateFieldPlaceholder: '<staticContent/> <variable/>',
              },
            },
          },
        },
      },
    },
  })
  return {
    ...createReactI18nextMock(),
    Trans: (props: React.ComponentProps<typeof actual.Trans>) => (
      <actual.Trans {...props} i18n={i18n} />
    ),
  }
})

type VarReferencePickerProps = {
  onChange: (value: string[]) => void
  filterVar?: (payload: { type: VarType }) => boolean
}

let fileUploadSettingMaxLength: number | undefined = 4

// Variable discovery is tested by the picker owner; expose only allowed choices here.
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange, filterVar }: VarReferencePickerProps) => (
    <>
      {[
        { name: 'pick-variable', type: VarType.arrayString },
        { name: 'String variable', type: VarType.string },
        { name: 'File list variable', type: VarType.arrayFile },
      ]
        .filter((variable) => !filterVar || filterVar(variable))
        .map((variable) => (
          <button key={variable.name} type="button" onClick={() => onChange(['node-a', 'var-a'])}>
            {variable.name}
          </button>
        ))}
    </>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/file-upload-setting', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    onChange: (payload: {
      allowed_file_extensions: string[]
      allowed_file_types: SupportUploadFileTypes[]
      allowed_file_upload_methods: TransferMethod[]
      max_length?: number
    }) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
          max_length: fileUploadSettingMaxLength,
        })
      }
    >
      file-upload-setting
    </button>
  ),
}))

const createPayload = (overrides?: Partial<ParagraphFormInput>): ParagraphFormInput => ({
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
  it('preserves and clears a select default when editing the field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <InputField
        nodeId="node-select-default"
        isEdit
        payload={{
          type: InputVarType.select,
          output_variable_name: 'decision',
          default_value: 'approve',
          option_source: { type: 'constant', selector: [], value: ['approve', 'reject'] },
        }}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )
    const defaultInput = screen.getByRole('textbox', { name: /prePopulateField/ })
    expect(defaultInput).toHaveValue('approve')
    await user.clear(defaultInput)
    await user.type(defaultInput, 'reject')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ default_value: 'reject' }))
    await user.clear(defaultInput)
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ default_value: '' }))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    fileUploadSettingMaxLength = 4
  })

  it('saves only from the field surface and ignores composition', () => {
    const onChange = vi.fn()
    render(
      <InputField
        nodeId="node-scope"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    const input = screen.getByRole('textbox', { name: /saveResponseAs/ })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyUp(input, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(createPayload())
  })

  it('should focus the field type from its visible label and save the selected type', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <InputField
        nodeId="node-type-label"
        isEdit
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const label = screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.fieldType')
    const typeSelector = screen.getByRole('combobox', {
      name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
    })
    await user.click(label)
    expect(typeSelector).toHaveFocus()
    await user.click(typeSelector)
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: InputVarType.select, output_variable_name: 'valid_name' }),
    )
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
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, 'invalid name')

    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.variableNameInvalid'),
    )!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' }))!.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should disable save and show validation error when variable name already exists', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-duplicate-name"
        isEdit={false}
        payload={createPayload()}
        unavailableVariableNames={['existing_name']}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, 'existing_name')

    expect(
      screen.getByText(
        'workflowHumanInput.nodes.humanInput.insertInputField.variableNameDuplicated',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    ).toBeDisabled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onChange).not.toHaveBeenCalled()
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
    await user.type(nameInput!, 'generated_name')
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
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
            value: 'initial',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const input = screen.getByRole('textbox', { name: /staticContent/ })
    await user.clear(input)
    await user.type(input, 'constant-default')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'constant',
      selector: [],
      value: 'constant-default',
    })
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

    await user.click(
      screen.getByText(
        /workflowHumanInput\.nodes\.humanInput\.insertInputField\.useConstantInstead/i,
      ),
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'constant',
      selector: ['node-y', 'var-y'],
      value: '',
    })
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

    await user.click(screen.getByText('String variable'))
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'variable',
      selector: ['node-a', 'var-a'],
      value: '',
    })
  })

  it('should switch to select payload when field type changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-7"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.select,
      output_variable_name: 'valid_name',
      option_source: {
        type: 'constant',
        selector: [],
        value: [],
      },
    })
    expect(
      screen.getByRole('textbox', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.prePopulateField/i,
      }),
    ).toHaveValue('')
  })

  it('should keep paragraph pre-populate editor available after switching back to paragraph', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-8"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.prePopulateField'),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.single-file\b/ }),
    )
    expect(
      screen.queryByText(
        /workflowHumanInput\.nodes\.humanInput\.insertInputField\.prePopulateField/i,
      ),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.paragraph\b/ }),
    )
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.prePopulateField'),
    ).toBeInTheDocument()
    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.staticContent'),
    )
    await user.type(screen.getByRole('textbox', { name: /staticContent/ }), 'Restored default')
    await user.click(screen.getByRole('button', { name: /insertInputField\.insert/i }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      type: InputVarType.paragraph,
      output_variable_name: 'valid_name',
      default: { type: 'constant', selector: [], value: 'Restored default' },
    })
  })

  it('should save constant select options', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-9"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' }),
      'alpha',
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }),
      'beta',
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.select,
      output_variable_name: 'valid_name',
      option_source: {
        type: 'constant',
        selector: [],
        value: ['alpha', 'beta'],
      },
    })
  })

  it('should preserve constant and variable select sources when toggling', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-10"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' }),
      'alpha',
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }),
      'beta',
    )
    await user.click(
      screen.getByText(/workflowHumanInput\.nodes\.humanInput\.insertInputField\.useVarInstead/i),
    )
    await user.click(screen.getByText('pick-variable'))
    await user.click(
      screen.getByText(
        /workflowHumanInput\.nodes\.humanInput\.insertInputField\.useConstantInstead/i,
      ),
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.select,
      output_variable_name: 'valid_name',
      option_source: {
        type: 'constant',
        selector: ['node-a', 'var-a'],
        value: ['alpha', 'beta'],
      },
    })
  })

  it('should only allow array[string] variables for select option source', async () => {
    const user = userEvent.setup()

    render(
      <InputField
        nodeId="node-11"
        isEdit={false}
        payload={createPayload()}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(
      screen.getByText(/workflowHumanInput\.nodes\.humanInput\.insertInputField\.useVarInstead/i),
    )

    expect(screen.getByRole('button', { name: 'pick-variable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'String variable' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'File list variable' })).not.toBeInTheDocument()
  })

  it('should save single file upload settings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-13"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.single-file\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'file-upload-setting' }))
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.singleFile,
      output_variable_name: 'valid_name',
      allowed_file_extensions: ['.pdf'],
      allowed_file_types: ['document'],
      allowed_file_upload_methods: ['local_file'],
    })
  })

  it('should save file-list upload settings and max upload count', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-14"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.multi-files\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'file-upload-setting' }))
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.multiFiles,
      output_variable_name: 'valid_name',
      allowed_file_extensions: ['.pdf'],
      allowed_file_types: ['document'],
      allowed_file_upload_methods: ['local_file'],
      number_limits: 4,
    })
  })

  it('should normalize empty file-list upload limit on save', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    fileUploadSettingMaxLength = Number.NaN

    render(
      <InputField
        nodeId="node-14-normalize"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.multi-files\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'file-upload-setting' }))
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        type: InputVarType.multiFiles,
        number_limits: 1,
      }),
    )
  })
})
