import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import HumanInputFieldRenderer from '../field-renderer'

vi.mock('@/app/components/base/textarea', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string, onChange: (event: { target: { value: string } }) => void }) => (
    <textarea
      data-testid="content-item-textarea"
      value={value}
      onChange={event => onChange({ target: { value: event.target.value } })}
    />
  ),
}))

vi.mock('@langgenius/dify-ui/select', () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode, onValueChange: (value: string) => void }) => (
    <div data-testid="content-item-select-root" onClick={() => onValueChange('alice')}>{children}</div>
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
    <button
      type="button"
      data-testid={`content-item-file-${fileConfig.number_limits ?? 0}`}
      onClick={() => onChange([{ id: 'file-1', name: 'report.pdf', size: 1, type: 'document', progress: 100, transferMethod: TransferMethod.local_file, supportFileType: 'document' }])}
    >
      {(value || []).map(file => file.name).join(',')}
    </button>
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
})
