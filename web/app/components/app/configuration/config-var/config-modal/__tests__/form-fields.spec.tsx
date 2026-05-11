/* eslint-disable ts/no-explicit-any */
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import ConfigModalFormFields from '../form-fields'

vi.mock('react-i18next', async () => {
  const React = await import('react')
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const ns = options?.ns as string | undefined
        return ns ? `${ns}.${key}` : key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ i18nKey, components }: { i18nKey: string, components?: Record<string, ReactNode> }) => (
      <span data-i18n-key={i18nKey}>
        {i18nKey}
        {components?.docLink}
      </span>
    ),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.example.com${path || ''}`,
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    onChange,
    value,
    fileConfig,
  }: {
    onChange: (files?: Array<Record<string, unknown>>) => void
    value: Array<Record<string, unknown>>
    fileConfig: Record<string, unknown>
  }) => (
    <div>
      <span data-testid="file-uploader-value">{JSON.stringify(value)}</span>
      <span data-testid="file-uploader-config">{JSON.stringify(fileConfig)}</span>
      <button
        type="button"
        onClick={() => onChange([
          { fileId: 'file-1', type: 'local_file', url: 'https://example.com/file.png' },
          { fileId: 'file-2', type: 'remote_url', url: 'https://example.com/file-2.png' },
        ])}
      >
        upload-file
      </button>
      <button type="button" data-testid="upload-empty-file" onClick={() => onChange(undefined)}>
        upload-empty-file
      </button>
    </div>
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

vi.mock('@langgenius/dify-ui/select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langgenius/dify-ui/select')>()

  return {
    ...actual,
    Select: ({ value, onValueChange, children }: { value: string, onValueChange: (value: string) => void, children: ReactNode }) => (
      <div>
        <button type="button" onClick={() => onValueChange(value === 'true' ? 'false' : 'beta')}>{`ui-select:${value}`}</button>
        <button type="button" onClick={() => onValueChange('__empty__')}>ui-select-empty</button>
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

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

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
  default: ({ onChange, maxLength }: { onChange: (value: number) => void, maxLength: number }) => (
    <button type="button" data-max-length={String(maxLength)} onClick={() => onChange(64)}>config-string</button>
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

  it('should wire file, json schema, and visibility controls', async () => {
    const textInputProps = createBaseProps()
    const textInputView = render(<ConfigModalFormFields {...textInputProps} />)
    expect(screen.getByText('variableConfig.hidden')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'variableConfig.hiddenDescription' }))
    expect(await screen.findByText('variableConfig.hiddenDescription')).toBeInTheDocument()
    const docLink = await screen.findByRole('link')
    expect(docLink).toHaveAttribute('href', 'https://docs.example.com/use-dify/nodes/user-input#hide-and-pre-fill-input-fields')
    expect(docLink).toHaveAttribute('target', '_blank')
    expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')
    textInputView.unmount()

    const singleFileProps = createBaseProps()
    singleFileProps.tempPayload = {
      ...singleFileProps.tempPayload,
      type: InputVarType.singleFile,
      allowed_file_types: ['document'],
      allowed_file_extensions: [],
      allowed_file_upload_methods: ['remote_url'],
    }
    const singleFileView = render(<ConfigModalFormFields {...singleFileProps} />)
    expect(screen.queryByText('variableConfig.hidden')).not.toBeInTheDocument()
    expect(screen.queryByText('variableConfig.hiddenDescription')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('single-file-setting'))
    fireEvent.click(screen.getByText('upload-file'))
    fireEvent.click(screen.getAllByText('unchecked')[0]!)

    expect(singleFileProps.onFilePayloadChange).toHaveBeenCalledWith({ number_limits: 1 })
    expect(singleFileProps.payloadChangeHandlers.default).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'file-1',
    }))
    expect(singleFileProps.payloadChangeHandlers.required).toHaveBeenCalledWith(true)
    expect(singleFileProps.payloadChangeHandlers.hide).not.toHaveBeenCalled()
    singleFileView.unmount()

    const multiFileProps = createBaseProps()
    multiFileProps.tempPayload = {
      ...multiFileProps.tempPayload,
      type: InputVarType.multiFiles,
      allowed_file_types: ['document'],
      allowed_file_extensions: [],
      allowed_file_upload_methods: ['remote_url'],
    }
    render(<ConfigModalFormFields {...multiFileProps} />)
    expect(screen.queryByText('variableConfig.hidden')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('multi-file-setting'))
    fireEvent.click(screen.getAllByText('upload-file')[0]!)
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

  it('should update text input metadata and clear empty defaults for string inputs', () => {
    const textProps = createBaseProps()
    textProps.isStringInput = true
    textProps.tempPayload = {
      ...textProps.tempPayload,
      type: InputVarType.textInput,
      default: 'hello',
    }

    render(<ConfigModalFormFields {...textProps} />)

    const variableInput = screen.getByDisplayValue('question')

    fireEvent.click(screen.getByText('type-selector'))
    fireEvent.change(variableInput, { target: { value: 'prompt' } })
    fireEvent.blur(variableInput)
    fireEvent.change(screen.getByDisplayValue('Question'), { target: { value: 'Prompt Label' } })
    fireEvent.click(screen.getByText('config-string'))
    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: '' } })

    expect(textProps.onTypeChange).toHaveBeenCalledWith({ value: InputVarType.select })
    expect(textProps.onVarNameChange).toHaveBeenCalled()
    expect(textProps.onVarKeyBlur).toHaveBeenCalled()
    expect(textProps.payloadChangeHandlers.label).toHaveBeenCalledWith('Prompt Label')
    expect(textProps.payloadChangeHandlers.max_length).toHaveBeenCalledWith(64)
    expect(textProps.payloadChangeHandlers.default).toHaveBeenCalledWith(undefined)
  })

  it('should clear select defaults and apply uploader fallback values', () => {
    const selectProps = createBaseProps()
    selectProps.tempPayload = { ...selectProps.tempPayload, type: InputVarType.select, default: 'alpha' }
    selectProps.options = ['alpha', ' ', 'beta']
    render(<ConfigModalFormFields {...selectProps} />)

    fireEvent.click(screen.getByText('ui-select-empty'))
    expect(selectProps.payloadChangeHandlers.default).toHaveBeenCalledWith(undefined)

    const singleFallbackProps = createBaseProps()
    singleFallbackProps.tempPayload = {
      ...singleFallbackProps.tempPayload,
      type: InputVarType.singleFile,
      default: undefined,
    }
    render(<ConfigModalFormFields {...singleFallbackProps} />)

    expect(screen.getAllByTestId('file-uploader-value')[0]).toHaveTextContent('[]')
    expect(screen.getAllByTestId('file-uploader-config')[0]).toHaveTextContent('"allowed_file_types":["document"]')
    expect(screen.getAllByTestId('file-uploader-config')[0]).toHaveTextContent('"allowed_file_upload_methods":["remote_url"]')
    expect(screen.getAllByTestId('file-uploader-config')[0]).toHaveTextContent('"number_limits":1')
    fireEvent.click(screen.getAllByTestId('upload-empty-file')[0]!)
    expect(singleFallbackProps.payloadChangeHandlers.default).toHaveBeenCalledWith(undefined)

    const multiFallbackProps = createBaseProps()
    multiFallbackProps.tempPayload = {
      ...multiFallbackProps.tempPayload,
      type: InputVarType.multiFiles,
      default: undefined,
      max_length: undefined,
    }
    render(<ConfigModalFormFields {...multiFallbackProps} />)

    expect(screen.getAllByTestId('file-uploader-value')[1]).toHaveTextContent('[]')
    expect(screen.getAllByTestId('file-uploader-config')[1]).toHaveTextContent('"number_limits":5')
    fireEvent.click(screen.getAllByTestId('upload-empty-file')[1]!)
    expect(multiFallbackProps.payloadChangeHandlers.default).toHaveBeenCalledWith(undefined)
  })

  it('should clear number defaults and skip rendering the default selector when options are missing', () => {
    const numberProps = createBaseProps()
    numberProps.tempPayload = { ...numberProps.tempPayload, type: InputVarType.number, default: '9' }
    render(<ConfigModalFormFields {...numberProps} />)

    fireEvent.change(screen.getByDisplayValue('9'), { target: { value: '' } })
    expect(numberProps.payloadChangeHandlers.default).toHaveBeenCalledWith(undefined)

    const selectWithoutOptionsProps = createBaseProps()
    selectWithoutOptionsProps.tempPayload = { ...selectWithoutOptionsProps.tempPayload, type: InputVarType.select }
    selectWithoutOptionsProps.options = undefined
    render(<ConfigModalFormFields {...selectWithoutOptionsProps} />)

    expect(screen.getAllByText('config-select')).toHaveLength(1)
    expect(screen.queryByText('ui-select:__empty__')).not.toBeInTheDocument()
  })

  it('should preserve existing select and file defaults when present', () => {
    const selectProps = createBaseProps()
    selectProps.tempPayload = { ...selectProps.tempPayload, type: InputVarType.select, default: undefined }
    selectProps.options = ['alpha', 'beta']
    render(<ConfigModalFormFields {...selectProps} />)

    expect(screen.getByText('ui-select:__empty__')).toBeInTheDocument()

    const existingFile = { fileId: 'existing-file', type: 'local_file', url: 'https://example.com/existing.png' }
    const singleFileProps = createBaseProps()
    singleFileProps.tempPayload = {
      ...singleFileProps.tempPayload,
      type: InputVarType.singleFile,
      default: existingFile,
    }
    render(<ConfigModalFormFields {...singleFileProps} />)

    expect(screen.getAllByTestId('file-uploader-value')[0]).toHaveTextContent('"fileId":"existing-file"')

    const existingFiles = [
      { fileId: 'file-1', type: 'local_file', url: 'https://example.com/1.png' },
      { fileId: 'file-2', type: 'remote_url', url: 'https://example.com/2.png' },
    ]
    const multiFileProps = createBaseProps()
    multiFileProps.tempPayload = {
      ...multiFileProps.tempPayload,
      type: InputVarType.multiFiles,
      default: existingFiles,
      max_length: 2,
    }
    render(<ConfigModalFormFields {...multiFileProps} />)

    expect(screen.getAllByTestId('file-uploader-value')[1]).toHaveTextContent('"fileId":"file-1"')
    expect(screen.getAllByTestId('file-uploader-config')[1]).toHaveTextContent('"number_limits":2')
  })

  it('should render empty fallback values for text, paragraph, and number defaults', () => {
    const textProps = createBaseProps()
    textProps.isStringInput = true
    textProps.tempPayload = { ...textProps.tempPayload, type: InputVarType.textInput, default: undefined }
    const textView = render(<ConfigModalFormFields {...textProps} />)

    expect(screen.getAllByPlaceholderText('variableConfig.inputPlaceholder')[2]).toHaveValue('')
    expect(screen.getByText('config-string')).toHaveAttribute('data-max-length', '256')
    textView.unmount()

    const paragraphProps = createBaseProps()
    paragraphProps.isStringInput = true
    paragraphProps.tempPayload = { ...paragraphProps.tempPayload, type: InputVarType.paragraph, default: undefined }
    const paragraphView = render(<ConfigModalFormFields {...paragraphProps} />)

    expect(screen.getByText('config-string')).toHaveAttribute('data-max-length', 'Infinity')
    expect(paragraphView.container.querySelector('textarea')).toHaveValue('')
    paragraphView.unmount()

    const numberProps = createBaseProps()
    numberProps.tempPayload = { ...numberProps.tempPayload, type: InputVarType.number, default: undefined }
    render(<ConfigModalFormFields {...numberProps} />)

    expect(screen.getByRole('spinbutton')).toHaveValue(null)
  })

  it('should disable hide checkbox when required is true and disable required when hide is true', () => {
    const requiredProps = createBaseProps()
    requiredProps.tempPayload = { ...requiredProps.tempPayload, type: InputVarType.textInput, required: true, hide: false }
    const { unmount } = render(<ConfigModalFormFields {...requiredProps} />)

    const buttons = screen.getAllByRole('button')
    const hideButton = buttons.find(btn => btn.textContent === 'unchecked' && btn !== buttons[0])
    expect(hideButton).toBeDefined()
    unmount()

    const hideProps = createBaseProps()
    hideProps.tempPayload = { ...hideProps.tempPayload, type: InputVarType.textInput, required: false, hide: true }
    render(<ConfigModalFormFields {...hideProps} />)

    const allButtons = screen.getAllByRole('button')
    const checkedHideButton = allButtons.find(btn => btn.textContent === 'checked')
    expect(checkedHideButton).toBeDefined()
  })
})
