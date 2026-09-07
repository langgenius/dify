import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { FileResponse } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import SubmittedContentItem from '../submitted-content-item'

const attachmentValue: FileResponse = {
  related_id: 'file-1',
  upload_file_id: 'upload-1',
  filename: 'decision.pdf',
  extension: 'pdf',
  size: 128,
  mime_type: 'application/pdf',
  transfer_method: TransferMethod.local_file,
  type: 'document',
  url: 'https://example.com/decision.pdf',
  remote_url: '',
}

const evidenceValues: FileResponse[] = [
  {
    related_id: 'file-2',
    upload_file_id: 'upload-2',
    filename: 'evidence.png',
    extension: 'png',
    size: 256,
    mime_type: 'image/png',
    transfer_method: TransferMethod.remote_url,
    type: 'image',
    url: 'https://example.com/evidence.png',
    remote_url: 'https://example.com/evidence.png',
  },
  {
    related_id: 'file-3',
    upload_file_id: 'upload-3',
    filename: 'evidence.pdf',
    extension: 'pdf',
    size: 512,
    mime_type: 'application/pdf',
    transfer_method: TransferMethod.local_file,
    type: 'document',
    url: 'https://example.com/evidence.pdf',
    remote_url: '',
  },
]

const fields: FormInputItem[] = [
  {
    type: InputVarType.paragraph,
    output_variable_name: 'summary',
    default: { type: 'constant', value: '', selector: [] },
  },
  {
    type: InputVarType.select,
    output_variable_name: 'decision',
    option_source: { type: 'constant', value: ['approve', 'reject'], selector: [] },
  },
  {
    type: InputVarType.singleFile,
    output_variable_name: 'attachment',
    allowed_file_extensions: [],
    allowed_file_types: [],
    allowed_file_upload_methods: [],
  },
  {
    type: InputVarType.multiFiles,
    output_variable_name: 'evidence',
    allowed_file_extensions: [],
    allowed_file_types: [],
    allowed_file_upload_methods: [],
    number_limits: 5,
  },
]

describe('SubmittedContentItem', () => {
  it('renders file-list output placeholders as readonly file lists', () => {
    render(
      <SubmittedContentItem
        content="{{#$output.evidence#}}"
        formInputFields={fields}
        values={{ evidence: evidenceValues }}
      />,
    )

    expect(screen.getByTestId('submitted-field-evidence')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Preview' })).toHaveAttribute(
      'src',
      'https://example.com/evidence.png',
    )
    expect(screen.getByText('evidence.pdf')).toBeInTheDocument()
  })

  it('renders empty text for paragraph and select placeholders with non-string values', () => {
    const { rerender } = render(
      <SubmittedContentItem
        content="{{#$output.summary#}}"
        formInputFields={fields}
        values={{ summary: attachmentValue }}
      />,
    )

    expect(screen.getByTestId('submitted-field-summary')).toHaveTextContent('')

    rerender(
      <SubmittedContentItem
        content="{{#$output.decision#}}"
        formInputFields={fields}
        values={{ decision: evidenceValues }}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'decision' })).toHaveTextContent('')
  })

  it('renders nothing when output placeholders do not have a usable submitted value', () => {
    const { container, rerender } = render(
      <SubmittedContentItem
        content="{{#$output.missing#}}"
        formInputFields={fields}
        values={{ missing: 'value' }}
      />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(
      <SubmittedContentItem
        content="{{#$output.attachment#}}"
        formInputFields={fields}
        values={{}}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('skips file placeholders when submitted values have incompatible shapes', () => {
    const { container, rerender } = render(
      <SubmittedContentItem
        content="{{#$output.attachment#}}"
        formInputFields={fields}
        values={{ attachment: 'not-a-file' }}
      />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(
      <SubmittedContentItem
        content="{{#$output.attachment#}}"
        formInputFields={fields}
        values={{ attachment: evidenceValues }}
      />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(
      <SubmittedContentItem
        content="{{#$output.evidence#}}"
        formInputFields={fields}
        values={{ evidence: attachmentValue }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for unsupported output field types', () => {
    const { container } = render(
      <SubmittedContentItem
        content="{{#$output.unknown#}}"
        formInputFields={[
          {
            type: 'unsupported',
            output_variable_name: 'unknown',
          } as unknown as FormInputItem,
        ]}
        values={{ unknown: 'value' }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
