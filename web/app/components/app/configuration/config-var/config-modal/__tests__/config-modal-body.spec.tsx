import type { ConfigModalState } from '../use-config-modal-state'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import ConfigModalBody from '../config-modal-body'

type PayloadChangeHandler = ConfigModalState['handlePayloadChange']
type PayloadValueHandler = ReturnType<PayloadChangeHandler>

let selectOnValueChange: ((value: string | null) => void) | undefined

vi.mock('@/app/components/base/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode
    onValueChange?: (value: string | null) => void
  }) => {
    selectOnValueChange = onValueChange
    return <div>{children}</div>
  },
  SelectTrigger: ({
    children,
    className,
    'aria-label': ariaLabel,
  }: {
    'children': React.ReactNode
    'className'?: string
    'aria-label'?: string
  }) => (
    <button type="button" role="combobox" className={className} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode
    value: string
  }) => (
    <div role="option" onClick={() => selectOnValueChange?.(value)}>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <div>
      <div data-testid="code-editor">{value}</div>
      <button type="button" onClick={() => onChange('{\n  "type": "object"\n}')}>change json</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/file-upload-setting', () => ({
  default: ({
    isMultiple,
    onChange,
    payload,
  }: {
    isMultiple: boolean
    onChange: (payload: InputVar) => void
    payload: InputVar
  }) => (
    <div>
      <div data-testid="file-upload-setting">{String(isMultiple)}</div>
      <button type="button" onClick={() => onChange({ ...payload, max_length: 9 })}>update file setting</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    onChange,
    value,
  }: {
    onChange: (files?: FileEntity[]) => void
    value: FileEntity[]
  }) => (
    <div data-testid="file-uploader" data-count={value.length}>
      <button type="button" onClick={() => onChange([{ id: 'file-1' } as FileEntity])}>upload one</button>
      <button type="button" onClick={() => onChange([{ id: 'file-1' }, { id: 'file-2' }] as FileEntity[])}>upload many</button>
    </div>
  ),
}))

const createPayloadChangeMock = () => {
  const handlers = new Map<keyof InputVar, PayloadValueHandler>()
  const handlePayloadChange: PayloadChangeHandler = vi.fn((key: keyof InputVar) => {
    const existing = handlers.get(key)
    if (existing)
      return existing

    const handler: PayloadValueHandler = vi.fn()
    handlers.set(key, handler)
    return handler
  })

  return {
    handlePayloadChange,
    handlers,
  }
}

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: 'Name',
  variable: 'name',
  required: false,
  hide: false,
  default: '',
  options: [],
  allowed_file_types: [SupportUploadFileTypes.document],
  allowed_file_extensions: ['pdf'],
  allowed_file_upload_methods: [TransferMethod.remote_url],
  max_length: 1,
  ...overrides,
})

const createState = (overrides: Partial<ConfigModalState> = {}) => {
  const payloadChange = createPayloadChangeMock()

  return {
    state: {
      checkboxDefaultSelectValue: 'false',
      handleConfirm: vi.fn(),
      handleJSONSchemaChange: vi.fn(),
      handlePayloadChange: payloadChange.handlePayloadChange,
      handleTypeChange: vi.fn(),
      handleVarKeyBlur: vi.fn(),
      handleVarNameChange: vi.fn(),
      isStringInput: true,
      jsonSchemaStr: '',
      modelId: 'test-model',
      modalRef: { current: null },
      selectOptions: [
        { value: InputVarType.textInput, name: 'Text Input' },
        { value: InputVarType.select, name: 'Select' },
      ],
      setTempPayload: vi.fn(),
      tempPayload: createInputVar(),
      ...overrides,
    } satisfies ConfigModalState,
    payloadHandlers: payloadChange.handlers,
  }
}

describe('ConfigModalBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectOnValueChange = undefined
  })

  // Covers the default text-input layout and footer callbacks.
  describe('text input mode', () => {
    it('should render text fields and trigger footer actions', () => {
      const { state, payloadHandlers } = createState()
      const onClose = vi.fn()

      render(<ConfigModalBody state={state} onClose={onClose} />)

      expect(screen.getAllByRole('textbox')).toHaveLength(3)

      fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Display Name' } })
      fireEvent.change(screen.getAllByRole('textbox')[2], { target: { value: 'Hello world' } })
      fireEvent.click(screen.getAllByRole('checkbox')[0])
      fireEvent.click(screen.getAllByRole('checkbox')[1])

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(payloadHandlers.get('label')).toHaveBeenCalledWith('Display Name')
      expect(payloadHandlers.get('default')).toHaveBeenCalledWith('Hello world')
      expect(payloadHandlers.get('required')).toHaveBeenCalledWith(true)
      expect(payloadHandlers.get('hide')).toHaveBeenCalledWith(true)
      expect(state.handleConfirm).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should send updates for paragraph and number defaults', () => {
      const paragraphState = createState({
        tempPayload: createInputVar({
          type: InputVarType.paragraph,
          default: 'Paragraph value',
        }),
      })

      const { container, unmount } = render(<ConfigModalBody state={paragraphState.state} onClose={vi.fn()} />)

      fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Updated paragraph' } })
      expect(paragraphState.payloadHandlers.get('default')).toHaveBeenCalledWith('Updated paragraph')

      unmount()

      const numberState = createState({
        isStringInput: false,
        tempPayload: createInputVar({
          type: InputVarType.number,
          default: '5',
        }),
      })

      const { container: numberContainer } = render(<ConfigModalBody state={numberState.state} onClose={vi.fn()} />)

      fireEvent.change(numberContainer.querySelector('input[type="number"]')!, { target: { value: '12' } })
      expect(numberState.payloadHandlers.get('default')).toHaveBeenCalledWith('12')
    })
  })

  // Covers select-specific sections and options wiring.
  describe('select mode', () => {
    it('should render select options and default selector when options exist', async () => {
      const { state, payloadHandlers } = createState({
        isStringInput: false,
        tempPayload: createInputVar({
          type: InputVarType.select,
          default: 'A',
          options: ['A', 'B'],
        }),
      })

      render(
        <ConfigModalBody
          state={state}
          onClose={vi.fn()}
        />,
      )

      expect(screen.getByText('appDebug.variableConfig.options')).toBeInTheDocument()
      expect(screen.getAllByText('A').length).toBeGreaterThan(0)

      fireEvent.click(screen.getByRole('combobox', { name: 'appDebug.variableConfig.selectDefaultValue' }))
      fireEvent.click(screen.getByRole('option', { name: 'B' }))

      await waitFor(() => {
        expect(state.handlePayloadChange).toHaveBeenCalledWith('default')
      })
      expect(payloadHandlers.get('default')).toHaveBeenCalledWith('B')
    })

    it('should convert checkbox selections into boolean defaults', async () => {
      const { state, payloadHandlers } = createState({
        isStringInput: false,
        tempPayload: createInputVar({
          type: InputVarType.checkbox,
          default: undefined,
        }),
      })

      render(<ConfigModalBody state={state} onClose={vi.fn()} />)

      fireEvent.click(screen.getByRole('combobox', { name: 'appDebug.variableConfig.selectDefaultValue' }))
      fireEvent.click(screen.getByRole('option', { name: 'appDebug.variableConfig.startChecked' }))

      await waitFor(() => {
        expect(state.handlePayloadChange).toHaveBeenCalledWith('default')
      })
      expect(payloadHandlers.get('default')).toHaveBeenCalledWith(true)
    })
  })

  // Covers file and JSON branches that were split out of the original entry component.
  describe('specialized sections', () => {
    it('should handle file settings and uploader changes for file inputs', () => {
      const singleFileState = createState({
        isStringInput: false,
        tempPayload: createInputVar({
          type: InputVarType.singleFile,
          default: undefined,
        }),
      })

      const { unmount } = render(
        <ConfigModalBody
          state={singleFileState.state}
          onClose={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText('update file setting'))
      fireEvent.click(screen.getByText('upload one'))

      expect(singleFileState.state.setTempPayload).toHaveBeenCalledWith(expect.objectContaining({ max_length: 9 }))
      expect(singleFileState.payloadHandlers.get('default')).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))

      unmount()

      const multiFileState = createState({
        isStringInput: false,
        tempPayload: createInputVar({
          type: InputVarType.multiFiles,
          default: [] as unknown as InputVar['default'],
        }),
      })

      render(
        <ConfigModalBody
          state={multiFileState.state}
          onClose={vi.fn()}
        />,
      )

      expect(screen.getByTestId('file-upload-setting')).toHaveTextContent('true')
      expect(screen.getByTestId('file-uploader')).toBeInTheDocument()

      fireEvent.click(screen.getByText('upload many'))
      expect(multiFileState.payloadHandlers.get('default')).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'file-1' }),
        expect.objectContaining({ id: 'file-2' }),
      ])
    })

    it('should render the JSON schema editor and propagate edits for json object inputs', () => {
      const { state } = createState({
        isStringInput: false,
        jsonSchemaStr: '{\n  "type": "object"\n}',
        tempPayload: createInputVar({
          type: InputVarType.jsonObject,
          default: undefined,
        }),
      })

      render(
        <ConfigModalBody
          state={state}
          onClose={vi.fn()}
        />,
      )

      expect(screen.getByTestId('code-editor')).toHaveTextContent('"type": "object"')
      fireEvent.click(screen.getByText('change json'))
      expect(state.handleJSONSchemaChange).toHaveBeenCalledWith('{\n  "type": "object"\n}')
    })
  })
})
