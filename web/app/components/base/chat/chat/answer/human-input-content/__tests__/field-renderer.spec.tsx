import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import HumanInputFieldRenderer from '../field-renderer'

function MockTextarea({
  value,
  onChange,
  onValueChange,
  ...props
}: {
  value: string
  onChange?: (event: { target: { value: string } }) => void
  onValueChange?: (value: string) => void
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      data-testid="content-item-textarea"
      value={value}
      onChange={(event) => {
        onChange?.({ target: { value: event.target.value } })
        onValueChange?.(event.target.value)
      }}
      {...props}
    />
  )
}

vi.mock('@langgenius/dify-ui/textarea', () => ({
  Textarea: MockTextarea,
}))

vi.mock('@langgenius/dify-ui/select', () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode, onValueChange: (value: string | null) => void }) => (
    <div>
      <button type="button" data-testid="content-item-select-root" onClick={() => onValueChange('alice')}>select alice</button>
      <button type="button" data-testid="content-item-select-null" onClick={() => onValueChange(null)}>select null</button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button" data-testid="content-item-select">{children}</button>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItemText: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectItemIndicator: () => <span>selected</span>,
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({ value, onChange, fileConfig }: {
    value?: FileEntity[]
    onChange: (files: FileEntity[]) => void
    fileConfig: { number_limits?: number }
  }) => (
    <>
      <button
        type="button"
        data-testid={`content-item-file-${fileConfig.number_limits ?? 0}`}
        onClick={() => onChange([{ id: 'file-1', name: 'report.pdf', size: 1, type: 'document', progress: 100, transferMethod: TransferMethod.local_file, supportFileType: 'document' }])}
      >
        {(value || []).map(file => file.name).join(',')}
      </button>
      <button
        type="button"
        data-testid={`content-item-file-clear-${fileConfig.number_limits ?? 0}`}
        onClick={() => onChange([])}
      >
        clear
      </button>
    </>
  ),
}))

describe('HumanInputFieldRenderer', () => {
  it('renders paragraph input and emits string changes', async () => {
    const onChange = vi.fn()

    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.paragraph,
          output_variable_name: 'summary',
          default: { type: 'constant', selector: [], value: '' },
        }}
        value="hello"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByTestId('content-item-textarea'), {
      target: { value: 'hello world' },
    })

    expect(onChange).toHaveBeenLastCalledWith('hello world')
  })

  it('renders paragraph input with an accessible name', () => {
    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.paragraph,
          output_variable_name: 'summary',
          default: { type: 'constant', selector: [], value: '' },
        }}
        value="hello"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('summary')).toHaveValue('hello')
  })

  it('renders paragraph input with an empty value when the current value is not a string', () => {
    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.paragraph,
          output_variable_name: 'summary',
          default: { type: 'constant', selector: [], value: '' },
        }}
        value={null}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('content-item-textarea')).toHaveValue('')
  })

  it('renders select input and emits selected values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.select,
          output_variable_name: 'reviewer',
          option_source: { type: 'constant', selector: [], value: ['alice', 'bob'] },
        }}
        value=""
        onChange={onChange}
      />,
    )

    await user.click(screen.getByTestId('content-item-select-root'))

    expect(onChange).toHaveBeenCalledWith('alice')
  })

  it('ignores null select values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.select,
          output_variable_name: 'reviewer',
          option_source: { type: 'constant', selector: [], value: ['alice', 'bob'] },
        }}
        value={null}
        onChange={onChange}
      />,
    )

    expect(screen.getByTestId('content-item-select')).toHaveTextContent('')

    await user.click(screen.getByTestId('content-item-select-null'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders single-file input and emits one file', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.singleFile,
          output_variable_name: 'attachment',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
        }}
        value={null}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByTestId('content-item-file-1'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'report.pdf' }))
  })

  it('renders existing single-file values and emits null when cleared', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.singleFile,
          output_variable_name: 'attachment',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
        }}
        value={{ id: 'file-2', name: 'existing.pdf', size: 1, type: 'document', progress: 100, transferMethod: TransferMethod.local_file, supportFileType: 'document' }}
        onChange={onChange}
      />,
    )

    expect(screen.getByTestId('content-item-file-1')).toHaveTextContent('existing.pdf')

    await user.click(screen.getByTestId('content-item-file-clear-1'))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('renders file-list input and emits file arrays with max count', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.multiFiles,
          output_variable_name: 'attachments',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
          number_limits: 3,
        }}
        value={[]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByTestId('content-item-file-3'))

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'report.pdf' })])
  })

  it('uses the default max count for file-list inputs without an explicit limit', () => {
    render(
      <HumanInputFieldRenderer
        field={{
          type: InputVarType.multiFiles,
          output_variable_name: 'attachments',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
        }}
        value={null}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('content-item-file-5')).toBeInTheDocument()
  })

  it('renders nothing for unsupported input types', () => {
    const { container } = render(
      <HumanInputFieldRenderer
        field={{
          type: 'unsupported',
          output_variable_name: 'unknown',
        } as unknown as Parameters<typeof HumanInputFieldRenderer>[0]['field']}
        value=""
        onChange={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
