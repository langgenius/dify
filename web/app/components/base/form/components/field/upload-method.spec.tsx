import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import UploadMethodField from './upload-method'

const mockField = {
  name: 'upload-method',
  state: {
    value: [TransferMethod.local_file] as TransferMethod[],
  },
  handleChange: vi.fn(),
}

vi.mock('../..', () => ({
  useFieldContext: () => mockField,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/option-card', () => ({
  default: ({
    title,
    selected,
    onSelect,
  }: {
    title: string
    selected: boolean
    onSelect: () => void
  }) => (
    <button aria-pressed={selected} onClick={onSelect}>
      {title}
    </button>
  ),
}))

describe('UploadMethodField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockField.state.value = [TransferMethod.local_file]
  })

  it('should show all upload method options', () => {
    render(<UploadMethodField label="Upload methods" />)

    expect(screen.getByText('Upload methods')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'appDebug.variableConfig.localUpload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'URL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'appDebug.variableConfig.both' })).toBeInTheDocument()
  })

  it('should switch to URL-only when users select URL', () => {
    render(<UploadMethodField label="Upload methods" />)

    fireEvent.click(screen.getByRole('button', { name: 'URL' }))
    expect(mockField.handleChange).toHaveBeenCalledWith([TransferMethod.remote_url])
  })

  it('should enable both methods when users select both', () => {
    render(<UploadMethodField label="Upload methods" />)

    fireEvent.click(screen.getByRole('button', { name: 'appDebug.variableConfig.both' }))
    expect(mockField.handleChange).toHaveBeenCalledWith([
      TransferMethod.local_file,
      TransferMethod.remote_url,
    ])
  })
})
