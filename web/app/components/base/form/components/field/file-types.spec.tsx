import { fireEvent, render, screen } from '@testing-library/react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import FileTypesField from './file-types'

type FileTypeValue = {
  allowedFileTypes: string[]
  allowedFileExtensions: string[]
}

const mockField = {
  name: 'allowed-types',
  state: {
    value: {
      allowedFileTypes: [],
      allowedFileExtensions: [],
    } as FileTypeValue,
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/file-type-item', () => ({
  default: ({
    type,
    onToggle,
    customFileTypes = [],
    onCustomFileTypesChange,
  }: {
    type: SupportUploadFileTypes
    onToggle: (type: SupportUploadFileTypes) => void
    customFileTypes?: string[]
    onCustomFileTypesChange?: (types: string[]) => void
  }) => (
    <div>
      <button onClick={() => onToggle(type)}>{type}</button>
      {onCustomFileTypesChange && (
        <input
          aria-label="custom file extensions"
          value={customFileTypes.join(',')}
          onChange={e => onCustomFileTypesChange(
            e.target.value.split(',').map(v => v.trim()).filter(Boolean),
          )}
        />
      )}
    </div>
  ),
}))

describe('FileTypesField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = {
      allowedFileTypes: [],
      allowedFileExtensions: [],
    }
  })

  it('should render the label and available type options', () => {
    render(<FileTypesField label="Allowed file types" />)

    expect(screen.getByText('Allowed file types')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SupportUploadFileTypes.document })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SupportUploadFileTypes.image })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SupportUploadFileTypes.audio })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SupportUploadFileTypes.video })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SupportUploadFileTypes.custom })).toBeInTheDocument()
  })

  it('should keep only custom when users choose custom types', () => {
    mockField.state.value.allowedFileTypes = [SupportUploadFileTypes.document]
    render(<FileTypesField label="Allowed file types" />)

    fireEvent.click(screen.getByRole('button', { name: SupportUploadFileTypes.custom }))
    expect(mockField.handleChange).toHaveBeenCalledWith({
      allowedFileTypes: [SupportUploadFileTypes.custom],
      allowedFileExtensions: [],
    })
  })

  it('should remove custom and add selected standard type', () => {
    mockField.state.value.allowedFileTypes = [SupportUploadFileTypes.custom]
    render(<FileTypesField label="Allowed file types" />)

    fireEvent.click(screen.getByRole('button', { name: SupportUploadFileTypes.image }))
    expect(mockField.handleChange).toHaveBeenCalledWith({
      allowedFileTypes: [SupportUploadFileTypes.image],
      allowedFileExtensions: [],
    })
  })

  it('should remove custom when users click custom again', () => {
    mockField.state.value.allowedFileTypes = [SupportUploadFileTypes.custom]
    render(<FileTypesField label="Allowed file types" />)

    fireEvent.click(screen.getByRole('button', { name: SupportUploadFileTypes.custom }))
    expect(mockField.handleChange).toHaveBeenCalledWith({
      allowedFileTypes: [],
      allowedFileExtensions: [],
    })
  })

  it('should remove a selected standard type when users click it again', () => {
    mockField.state.value.allowedFileTypes = [SupportUploadFileTypes.image]
    render(<FileTypesField label="Allowed file types" />)

    fireEvent.click(screen.getByRole('button', { name: SupportUploadFileTypes.image }))
    expect(mockField.handleChange).toHaveBeenCalledWith({
      allowedFileTypes: [],
      allowedFileExtensions: [],
    })
  })

  it('should update custom extensions when users type custom extension values', () => {
    render(<FileTypesField label="Allowed file types" />)

    fireEvent.change(screen.getByRole('textbox', { name: 'custom file extensions' }), {
      target: { value: 'csv,pdf' },
    })
    expect(mockField.handleChange).toHaveBeenCalledWith({
      allowedFileTypes: [],
      allowedFileExtensions: ['csv', 'pdf'],
    })
  })
})
