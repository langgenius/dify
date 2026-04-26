import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { FileResponse, HumanInputFormValue } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import SubmittedFieldValues from '../submitted-field-values'

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
    filename: 'evidence-1.png',
    extension: 'png',
    size: 256,
    mime_type: 'image/png',
    transfer_method: TransferMethod.remote_url,
    type: 'image',
    url: 'https://example.com/evidence-1.png',
    remote_url: 'https://example.com/evidence-1.png',
  },
  {
    related_id: 'file-3',
    upload_file_id: 'upload-3',
    filename: 'evidence-2.pdf',
    extension: 'pdf',
    size: 512,
    mime_type: 'application/pdf',
    transfer_method: TransferMethod.local_file,
    type: 'document',
    url: 'https://example.com/evidence-2.pdf',
    remote_url: '',
  },
]

const values: Record<string, HumanInputFormValue> = {
  summary: 'Need more context',
  decision: 'approve',
  attachment: attachmentValue,
  evidence: evidenceValues,
}

describe('SubmittedFieldValues', () => {
  it('renders text and select values as text', () => {
    render(<SubmittedFieldValues fields={fields} values={values} />)

    expect(screen.getByTestId('submitted-field-summary')).toHaveTextContent('Need more context')
    expect(screen.getByTestId('submitted-field-decision')).toHaveTextContent('approve')
  })

  it('renders file and file-list values as file lists', () => {
    render(<SubmittedFieldValues fields={fields} values={values} />)

    expect(screen.getByTestId('submitted-field-attachment')).toHaveTextContent('decision.pdf')
    expect(screen.getByRole('img', { name: 'Preview' })).toHaveAttribute('src', 'https://example.com/evidence-1.png')
    expect(screen.getByText('evidence-2.pdf')).toBeInTheDocument()
    expect(screen.getAllByTestId('file-list')).toHaveLength(2)
  })

  it('skips fields with missing values', () => {
    render(<SubmittedFieldValues fields={fields} values={{ summary: 'Only one field' }} />)

    expect(screen.getByTestId('submitted-field-summary')).toHaveTextContent('Only one field')
    expect(screen.queryByTestId('submitted-field-decision')).not.toBeInTheDocument()
    expect(screen.queryByTestId('submitted-field-attachment')).not.toBeInTheDocument()
  })
})
