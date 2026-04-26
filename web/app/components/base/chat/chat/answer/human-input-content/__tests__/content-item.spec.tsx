import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransferMethod } from '@/types/app'
import ContentItem from '../content-item'

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="mock-markdown">{content}</div>,
}))

vi.mock('../field-renderer', () => ({
  __esModule: true,
  default: ({ field, onChange }: { field: FormInputItem, onChange: (value: unknown) => void }) => (
    <button type="button" data-testid={`renderer-${field.type}`} onClick={() => onChange(field.type === 'paragraph' ? 'updated value' : field.type)}>
      {field.type}
    </button>
  ),
}))

describe('ContentItem', () => {
  const mockOnInputChange = vi.fn()
  const mockFormInputFields: FormInputItem[] = [
    {
      type: 'paragraph',
      output_variable_name: 'user_bio',
      default: {
        type: 'constant',
        value: '',
        selector: [],
      },
    } as FormInputItem,
  ]
  const mockInputs = {
    user_bio: 'Initial bio',
  }

  it('should render Markdown for literal content', () => {
    render(
      <ContentItem
        content="Hello world"
        formInputFields={[]}
        inputs={{}}
        onInputChange={mockOnInputChange}
      />,
    )

    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('Hello world')
    expect(screen.queryByTestId('content-item-textarea')).not.toBeInTheDocument()
  })

  it('should render Textarea for valid output variable content', () => {
    render(
      <ContentItem
        content="{{#$output.user_bio#}}"
        formInputFields={mockFormInputFields}
        inputs={mockInputs}
        onInputChange={mockOnInputChange}
      />,
    )

    const textarea = screen.getByTestId('renderer-paragraph')
    expect(textarea).toBeInTheDocument()
    expect(screen.queryByTestId('mock-markdown')).not.toBeInTheDocument()
  })

  it('should call onInputChange when textarea value changes', async () => {
    const user = userEvent.setup()
    render(
      <ContentItem
        content="{{#$output.user_bio#}}"
        formInputFields={mockFormInputFields}
        inputs={mockInputs}
        onInputChange={mockOnInputChange}
      />,
    )

    await user.click(screen.getByTestId('renderer-paragraph'))

    expect(mockOnInputChange).toHaveBeenCalledWith('user_bio', 'updated value')
  })

  it('should render nothing if field name is valid but not found in formInputFields', () => {
    const { container } = render(
      <ContentItem
        content="{{#$output.unknown_field#}}"
        formInputFields={mockFormInputFields}
        inputs={mockInputs}
        onInputChange={mockOnInputChange}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('should delegate select fields to the shared renderer', async () => {
    const user = userEvent.setup()

    render(
      <ContentItem
        content="{{#$output.user_bio#}}"
        formInputFields={[
          {
            type: 'select',
            output_variable_name: 'user_bio',
            option_source: {
              type: 'constant',
              selector: [],
              value: [],
            },
          } as FormInputItem,
        ]}
        inputs={mockInputs}
        onInputChange={mockOnInputChange}
      />,
    )

    await user.click(screen.getByTestId('renderer-select'))

    expect(mockOnInputChange).toHaveBeenCalledWith('user_bio', 'select')
  })

  it('should delegate single-file fields to the shared renderer', async () => {
    const user = userEvent.setup()

    render(
      <ContentItem
        content="{{#$output.attachment#}}"
        formInputFields={[
          {
            type: 'file',
            output_variable_name: 'attachment',
            allowed_file_extensions: ['.pdf'],
            allowed_file_types: ['document'],
            allowed_file_upload_methods: ['local_file'],
          } as FormInputItem,
        ]}
        inputs={{ attachment: null }}
        onInputChange={mockOnInputChange}
      />,
    )

    await user.click(screen.getByTestId('renderer-file'))

    expect(mockOnInputChange).toHaveBeenCalledWith('attachment', 'file')
  })

  it('should delegate file-list fields to the shared renderer', async () => {
    const user = userEvent.setup()
    const existingFiles: FileEntity[] = [{
      id: 'file-1',
      name: 'brief.pdf',
      size: 128,
      type: 'document',
      progress: 100,
      transferMethod: TransferMethod.local_file,
      supportFileType: 'document',
    }]

    render(
      <ContentItem
        content="{{#$output.attachments#}}"
        formInputFields={[
          {
            type: 'file-list',
            output_variable_name: 'attachments',
            allowed_file_extensions: ['.pdf'],
            allowed_file_types: ['document'],
            allowed_file_upload_methods: ['local_file'],
            number_limits: 4,
          } as FormInputItem,
        ]}
        inputs={{ attachments: existingFiles }}
        onInputChange={mockOnInputChange}
      />,
    )

    await user.click(screen.getByTestId('renderer-file-list'))

    expect(mockOnInputChange).toHaveBeenCalledWith('attachments', 'file-list')
  })
})
