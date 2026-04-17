/* eslint-disable ts/no-explicit-any */
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import ConfigModalFormFields from '../form-fields'

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({ onChange }: { onChange: (files: Array<Record<string, unknown>>) => void }) => (
    <button
      type="button"
      onClick={() => onChange([
        { fileId: 'file-1', type: 'local_file', url: 'https://example.com/file.png' },
        { fileId: 'file-2', type: 'remote_url', url: 'https://example.com/file-2.png' },
      ])}
    >
      upload-file
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/file-upload-setting', () => ({
  default: ({ onChange, isMultiple }: { onChange: (payload: Record<string, unknown>) => void, isMultiple: boolean }) => (
    <button type="button" onClick={() => onChange({ number_limits: isMultiple ? 3 : 1 })}>
      {isMultiple ? 'multi-file-setting' : 'single-file-setting'}
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('{\n  "type": "object"\n}')}>json-editor</button>
  ),
}))

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ onCheck, checked }: { onCheck: () => void, checked: boolean }) => (
    <button type="button" onClick={onCheck}>{checked ? 'checked' : 'unchecked'}</button>
  ),
}))

vi.mock('@/app/components/base/select', () => ({
  default: ({ onSelect }: { onSelect: (item: { value: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ value: 'beta' })}>legacy-select</button>
  ),
}))

vi.mock('@/app/components/base/ui/select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/ui/select')>()

  return {
    ...actual,
    Select: ({ value, onValueChange, children }: { value: string, onValueChange: (value: string) => void, children: ReactNode }) => (
      <div>
        <button type="button" onClick={() => onValueChange(value === 'true' ? 'false' : 'beta')}>{`ui-select:${value}`}</button>
        {children}
      </div>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span>select-value</span>,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    SelectItemIndicator: () => <span data-testid="select-item-indicator" />,
  }
})

vi.mock('../field', () => ({
  default: ({ children, title }: { children: ReactNode, title: string }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
}))

vi.mock('../type-select', () => ({
  default: ({ onSelect }: { onSelect: (item: { value: InputVarType }) => void }) => (
    <button type="button" onClick={() => onSelect({ value: InputVarType.select })}>type-selector</button>
  ),
}))

vi.mock('../../config-select', () => ({
  default: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['alpha', 'beta'])}>config-select</button>
  ),
}))

vi.mock('../../config-string', () => ({
  default: ({ onChange }: { onChange: (value: number) => void }) => (
    <button type="button" onClick={() => onChange(64)}>config-string</button>
  ),
}))

const t = (key: string) => key

const createPayloadChangeHandler = () => vi.fn<(value: unknown) => void>()

const createBaseProps = () => {
  const payloadChangeHandlers: Record<string, ReturnType<typeof createPayloadChangeHandler>> = {
    default: createPayloadChangeHandler(),
    hide: createPayloadChangeHandler(),
    label: createPayloadChangeHandler(),
    max_length: createPayloadChangeHandler(),
    options: createPayloadChangeHandler(),
    required: createPayloadChangeHandler(),
  }

  return {
    checkboxDefaultSelectValue: 'false',
    isStringInput: false,
    jsonSchemaStr: '',
    maxLength: 32,
    modelId: 'gpt-4o',
    onFilePayloadChange: vi.fn(),
    onJSONSchemaChange: vi.fn(),
    onPayloadChange: (key: string) => {
      if (!payloadChangeHandlers[key])
        payloadChangeHandlers[key] = createPayloadChangeHandler()
      return payloadChangeHandlers[key]
    },
    onTypeChange: vi.fn(),
    onVarKeyBlur: vi.fn(),
    onVarNameChange: vi.fn(),
    options: undefined as string[] | undefined,
    selectOptions: [],
    tempPayload: {
      type: InputVarType.textInput,
      label: 'Question',
      variable: 'question',
      required: false,
      hide: false,
    } as any,
    t,
    payloadChangeHandlers,
  }
}

describe('ConfigModalFormFields', () => {
  it('should update paragraph, number, checkbox, and select defaults', () => {
    const paragraphProps = createBaseProps()
    paragraphProps.tempPayload = { ...paragraphProps.tempPayload, type: InputVarType.paragraph, default: 'hello' }
    render(<ConfigModalFormFields {...paragraphProps} />)
    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'updated paragraph' } })
    expect(paragraphProps.payloadChangeHandlers.default).toHaveBeenCalledWith('updated paragraph')

    const numberProps = createBaseProps()
    numberProps.tempPayload = { ...numberProps.tempPayload, type: InputVarType.number, default: '1' }
    render(<ConfigModalFormFields {...numberProps} />)
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } })
    expect(numberProps.payloadChangeHandlers.default).toHaveBeenCalledWith('2')

    const checkboxProps = createBaseProps()
    checkboxProps.tempPayload = { ...checkboxProps.tempPayload, type: InputVarType.checkbox, default: false }
    checkboxProps.checkboxDefaultSelectValue = 'true'
    render(<ConfigModalFormFields {...checkboxProps} />)
    fireEvent.click(screen.getByText('ui-select:true'))
    expect(checkboxProps.payloadChangeHandlers.default).toHaveBeenCalledWith(false)

    const selectProps = createBaseProps()
    selectProps.tempPayload = { ...selectProps.tempPayload, type: InputVarType.select, default: 'alpha' }
    selectProps.options = ['alpha', 'beta']
    render(<ConfigModalFormFields {...selectProps} />)
    fireEvent.click(screen.getByText('config-select'))
    fireEvent.click(screen.getByText('ui-select:alpha'))
    expect(selectProps.payloadChangeHandlers.options).toHaveBeenCalledWith(['alpha', 'beta'])
    expect(selectProps.payloadChangeHandlers.default).toHaveBeenCalledWith('beta')
  })

  it('should wire file, json schema, and visibility controls', () => {
    const singleFileProps = createBaseProps()
    singleFileProps.tempPayload = {
      ...singleFileProps.tempPayload,
      type: InputVarType.singleFile,
      allowed_file_types: ['document'],
      allowed_file_extensions: [],
      allowed_file_upload_methods: ['remote_url'],
    }
    render(<ConfigModalFormFields {...singleFileProps} />)
    fireEvent.click(screen.getByText('single-file-setting'))
    fireEvent.click(screen.getByText('upload-file'))
    fireEvent.click(screen.getAllByText('unchecked')[0]!)
    fireEvent.click(screen.getAllByText('unchecked')[1]!)

    expect(singleFileProps.onFilePayloadChange).toHaveBeenCalledWith({ number_limits: 1 })
    expect(singleFileProps.payloadChangeHandlers.default).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'file-1',
    }))
    expect(singleFileProps.payloadChangeHandlers.required).toHaveBeenCalledWith(true)
    expect(singleFileProps.payloadChangeHandlers.hide).toHaveBeenCalledWith(true)

    const multiFileProps = createBaseProps()
    multiFileProps.tempPayload = {
      ...multiFileProps.tempPayload,
      type: InputVarType.multiFiles,
      allowed_file_types: ['document'],
      allowed_file_extensions: [],
      allowed_file_upload_methods: ['remote_url'],
    }
    render(<ConfigModalFormFields {...multiFileProps} />)
    fireEvent.click(screen.getByText('multi-file-setting'))
    fireEvent.click(screen.getAllByText('upload-file')[1]!)
    expect(multiFileProps.onFilePayloadChange).toHaveBeenCalledWith({ number_limits: 3 })
    expect(multiFileProps.payloadChangeHandlers.default).toHaveBeenCalledWith([
      expect.objectContaining({ fileId: 'file-1' }),
      expect.objectContaining({ fileId: 'file-2' }),
    ])

    const jsonProps = createBaseProps()
    jsonProps.tempPayload = { ...jsonProps.tempPayload, type: InputVarType.jsonObject }
    render(<ConfigModalFormFields {...jsonProps} />)
    fireEvent.click(screen.getByText('json-editor'))
    expect(jsonProps.onJSONSchemaChange).toHaveBeenCalledWith('{\n  "type": "object"\n}')
  })
})
