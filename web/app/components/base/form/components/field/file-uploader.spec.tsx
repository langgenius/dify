import { fireEvent, render, screen } from '@testing-library/react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import FileUploaderField from './file-uploader'

const mockField = {
  name: 'files',
  state: {
    value: [
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 1024,
        type: 'application/pdf',
        progress: 100,
        transferMethod: TransferMethod.local_file,
        supportFileType: SupportUploadFileTypes.document,
        uploadedId: 'uploaded-1',
        url: 'https://example.com/report.pdf',
      },
    ],
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'test-token' }),
}))

describe('FileUploaderField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = [
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 1024,
        type: 'application/pdf',
        progress: 100,
        transferMethod: TransferMethod.local_file,
        supportFileType: SupportUploadFileTypes.document,
        uploadedId: 'uploaded-1',
        url: 'https://example.com/report.pdf',
      },
    ]
  })

  it('should render existing uploaded file name', () => {
    render(
      <FileUploaderField
        label="Attachments"
        fileConfig={{
          allowed_file_upload_methods: [TransferMethod.local_file],
          allowed_file_types: [SupportUploadFileTypes.document],
        }}
      />,
    )

    expect(screen.getByText('Attachments')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
  })

  it('should update field value when users remove a file', () => {
    render(
      <FileUploaderField
        label="Attachments"
        fileConfig={{
          allowed_file_upload_methods: [TransferMethod.local_file],
          allowed_file_types: [SupportUploadFileTypes.document],
        }}
      />,
    )

    const deleteButtons = screen.getAllByRole('button')
    fireEvent.click(deleteButtons[1])
    expect(mockField.handleChange).toHaveBeenCalledWith([])
  })
})
