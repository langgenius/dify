import type { FormInputItem, ParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType, SupportUploadFileTypes, VarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import InputField from '../input-field'

type VarReferencePickerProps = {
  onChange: (value: string[]) => void
  filterVar?: (payload: { type: VarType }) => boolean
}

let lastVarReferencePickerProps: VarReferencePickerProps | undefined
let firstVarReferencePickerProps: VarReferencePickerProps | undefined
let fileUploadSettingMaxLength: number | undefined = 4

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: (props: VarReferencePickerProps) => {
    firstVarReferencePickerProps ||= props
    lastVarReferencePickerProps = props
    return (
      <button type="button" onClick={() => props.onChange(['node-a', 'var-a'])}>
        pick-variable
      </button>
    )
  },
}))

vi.mock('@/app/components/app/configuration/config-var/config-modal/type-select', () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (item: { value: InputVarType }) => void }) => (
    <div>
      <button type="button" onClick={() => onSelect({ value: InputVarType.paragraph })}>
        select-paragraph
      </button>
      <button type="button" onClick={() => onSelect({ value: InputVarType.select })}>
        select-select
      </button>
      <button type="button" onClick={() => onSelect({ value: InputVarType.singleFile })}>
        select-file
      </button>
      <button type="button" onClick={() => onSelect({ value: InputVarType.multiFiles })}>
        select-file-list
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/app/configuration/config-var/config-select', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (options: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['alpha', 'beta'])}>
      config-select
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/file-upload-setting', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (payload: {
    allowed_file_extensions: string[]
    allowed_file_types: SupportUploadFileTypes[]
    allowed_file_upload_methods: TransferMethod[]
    max_length?: number
  }) => void }) => (
    <button
      type="button"
      onClick={() => onChange({
        allowed_file_extensions: ['.pdf'],
        allowed_file_types: [SupportUploadFileTypes.document],
        allowed_file_upload_methods: [TransferMethod.local_file],
        max_length: fileUploadSettingMaxLength,
      })}
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
  beforeEach(() => {
    vi.clearAllMocks()
    lastVarReferencePickerProps = undefined
    firstVarReferencePickerProps = undefined
    fileUploadSettingMaxLength = 4
  })

  it('should keep the header and actions visible while the field content scrolls internally', () => {
    const { container } = render(
      <InputField
        nodeId="node-layout"
        isEdit={false}
        payload={createPayload()}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const panel = container.firstElementChild
    const header = panel?.children[0]
    const scrollBody = panel?.children[1]
    const footer = panel?.lastElementChild

    // The max-height falls back to a viewport unit so the panel stays bounded
    // (and the footer/actions reachable via the internal scroll) even when it is
    // rendered outside the shortcuts popup that defines --shortcut-popup-max-height,
    // e.g. inside the edit dialog. See issue #37979.
    expect(panel).toHaveClass('max-h-[var(--shortcut-popup-max-height,80dvh)]', 'overflow-hidden')
    expect(header).toHaveClass('shrink-0', 'pb-2')
    expect(scrollBody).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(footer).toHaveClass('shrink-0', 'bg-components-panel-bg')
    expect(footer).not.toHaveClass('border-t')
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

    expect(screen.getByText('workflow.nodes.humanInput.insertInputField.variableNameInvalid'))!.toBeInTheDocument()
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

    expect(screen.getByText('workflow.nodes.humanInput.insertInputField.variableNameDuplicated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i })).toBeDisabled()
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
    expect(onChange.mock.calls[0]![0]).toEqual(createPayload())
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
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

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
            value: '',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.keyboard('{Tab}')
    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[1]!, 'constant-default')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].default).toEqual({
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
    expect(onChange.mock.calls[0]![0].default.type).toBe('variable')
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
    expect(onChange.mock.calls[0]![0].default.type).toBe('constant')
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
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'variable',
      selector: ['node-a', 'var-a'],
      value: '',
    })
  })

  it('should keep the typed variable name when a stale pre-populate selector callback updates later', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-stale-selector"
        isEdit={false}
        payload={createPayload({
          output_variable_name: '',
          default: {
            type: 'variable',
            selector: ['node-old', 'text'],
            value: '',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const staleSelectorCallback = firstVarReferencePickerProps?.onChange

    await user.type(screen.getByRole('textbox'), 'reviewed_markdown')
    act(() => {
      staleSelectorCallback?.(['llm_node', 'text'])
    })
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.paragraph,
      output_variable_name: 'reviewed_markdown',
      default: {
        type: 'variable',
        selector: ['llm_node', 'text'],
        value: '',
      },
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
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'variable',
      selector: [],
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

    await user.click(screen.getByRole('button', { name: 'select-select' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

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
    expect(screen.queryByText(/workflow\.nodes\.humanInput\.insertInputField\.prePopulateField/i)).not.toBeInTheDocument()
  })

  it('should keep paragraph pre-populate editor available after switching back to paragraph', async () => {
    const user = userEvent.setup()

    render(
      <InputField
        nodeId="node-8"
        isEdit={false}
        payload={createPayload()}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.prePopulateField/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'select-file' }))
    expect(screen.queryByText(/workflow\.nodes\.humanInput\.insertInputField\.prePopulateField/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'select-paragraph' }))
    expect(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.prePopulateField/i)).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'select-select' }))
    await user.click(screen.getByRole('button', { name: 'config-select' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

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

    await user.click(screen.getByRole('button', { name: 'select-select' }))
    await user.click(screen.getByRole('button', { name: 'config-select' }))
    await user.click(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.useVarInstead/i))
    await user.click(screen.getByText('pick-variable'))
    await user.click(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.useConstantInstead/i))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

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

    await user.click(screen.getByRole('button', { name: 'select-select' }))
    await user.click(screen.getByText(/workflow\.nodes\.humanInput\.insertInputField\.useVarInstead/i))

    expect(lastVarReferencePickerProps?.filterVar?.({ type: VarType.arrayString })).toBe(true)
    expect(lastVarReferencePickerProps?.filterVar?.({ type: VarType.string })).toBe(false)
    expect(lastVarReferencePickerProps?.filterVar?.({ type: VarType.arrayFile })).toBe(false)
  })

  it('should clear paragraph default state when switching to select', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-12"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'constant',
            selector: [],
            value: 'paragraph-default',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'select-select' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('default')
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

    await user.click(screen.getByRole('button', { name: 'select-file' }))
    await user.click(screen.getByRole('button', { name: 'file-upload-setting' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.singleFile,
      output_variable_name: 'valid_name',
      allowed_file_extensions: ['.pdf'],
      allowed_file_types: ['document'],
      allowed_file_upload_methods: ['local_file'],
    })
  })

  it('should clear paragraph default state when switching to single file', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-13-1"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'constant',
            selector: [],
            value: 'paragraph-default',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'select-file' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('default')
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

    await user.click(screen.getByRole('button', { name: 'select-file-list' }))
    await user.click(screen.getByRole('button', { name: 'file-upload-setting' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

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

    await user.click(screen.getByRole('button', { name: 'select-file-list' }))
    await user.click(screen.getByRole('button', { name: 'file-upload-setting' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual(expect.objectContaining({
      type: InputVarType.multiFiles,
      number_limits: 1,
    }))
  })

  it('should clear paragraph default state when switching to file-list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="node-14-1"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'constant',
            selector: [],
            value: 'paragraph-default',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'select-file-list' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.insertInputField\.insert/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('default')
  })
})
