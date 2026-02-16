import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FileContextProvider } from '../store'
import FileFromLinkOrLocal from './index'

let mockFiles: FileEntity[] = []

function createStubFile(id: string): FileEntity {
  return { id, name: `${id}.txt`, size: 0, type: '', progress: 100, transferMethod: 'local_file' as FileEntity['transferMethod'], supportFileType: 'document' }
}

const mockHandleLoadFileFromLink = vi.fn()
vi.mock('../hooks', () => ({
  useFile: () => ({
    handleLoadFileFromLink: mockHandleLoadFileFromLink,
  }),
}))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
} as FileUpload)

function renderAndOpen(props: Partial<React.ComponentProps<typeof FileFromLinkOrLocal>> = {}) {
  const trigger = props.trigger ?? ((open: boolean) => <button data-testid="trigger">{open ? 'Close' : 'Open'}</button>)
  const result = render(
    <FileContextProvider value={mockFiles}>
      <FileFromLinkOrLocal
        trigger={trigger}
        fileConfig={props.fileConfig ?? createFileConfig()}
        {...props}
      />
    </FileContextProvider>,
  )
  fireEvent.click(screen.getByTestId('trigger'))
  return result
}

describe('FileFromLinkOrLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFiles = []
  })

  it('should render trigger element', () => {
    const trigger = (open: boolean) => (
      <button data-testid="trigger">
        Open
        {open ? 'close' : 'open'}
      </button>
    )
    render(
      <FileContextProvider value={mockFiles}>
        <FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} />
      </FileContextProvider>,
    )

    expect(screen.getByTestId('trigger')).toBeInTheDocument()
  })

  it('should render URL input when showFromLink is true', () => {
    renderAndOpen({ showFromLink: true })

    expect(screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)).toBeInTheDocument()
  })

  it('should render upload button when showFromLocal is true', () => {
    renderAndOpen({ showFromLocal: true })

    expect(screen.getByText(/fileUploader\.uploadFromComputer/)).toBeInTheDocument()
  })

  it('should render OR divider when both link and local are shown', () => {
    renderAndOpen({ showFromLink: true, showFromLocal: true })

    expect(screen.getByText('OR')).toBeInTheDocument()
  })

  it('should not render OR divider when only link is shown', () => {
    renderAndOpen({ showFromLink: true, showFromLocal: false })

    expect(screen.queryByText('OR')).not.toBeInTheDocument()
  })

  it('should show error when invalid URL is submitted', () => {
    renderAndOpen({ showFromLink: true })

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    fireEvent.change(input, { target: { value: 'invalid-url' } })

    const okButton = screen.getByText(/operation\.ok/)
    fireEvent.click(okButton)

    expect(screen.getByText(/fileUploader\.pasteFileLinkInvalid/)).toBeInTheDocument()
  })

  it('should clear error when input changes', () => {
    renderAndOpen({ showFromLink: true })

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    fireEvent.change(input, { target: { value: 'invalid-url' } })
    fireEvent.click(screen.getByText(/operation\.ok/))

    expect(screen.getByText(/fileUploader\.pasteFileLinkInvalid/)).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'https://example.com' } })
    expect(screen.queryByText(/fileUploader\.pasteFileLinkInvalid/)).not.toBeInTheDocument()
  })

  it('should disable ok button when url is empty', () => {
    renderAndOpen({ showFromLink: true })

    const okButton = screen.getByText(/operation\.ok/)
    expect(okButton.closest('button')).toBeDisabled()
  })

  it('should disable inputs when file limit is reached', () => {
    mockFiles = ['1', '2', '3', '4', '5'].map(createStubFile)
    renderAndOpen({ fileConfig: createFileConfig({ number_limits: 5 }), showFromLink: true, showFromLocal: true })

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    expect(input).toBeDisabled()
  })

  it('should not submit when url is empty', () => {
    renderAndOpen({ showFromLink: true })

    const okButton = screen.getByText(/operation\.ok/)
    fireEvent.click(okButton)

    expect(screen.queryByText(/fileUploader\.pasteFileLinkInvalid/)).not.toBeInTheDocument()
  })

  it('should call handleLoadFileFromLink when valid URL is submitted', () => {
    renderAndOpen({ showFromLink: true })

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/)
    fireEvent.change(input, { target: { value: 'https://example.com/file.pdf' } })
    fireEvent.click(screen.getByText(/operation\.ok/))

    expect(mockHandleLoadFileFromLink).toHaveBeenCalledWith('https://example.com/file.pdf')
  })

  it('should clear URL input after successful submission', () => {
    renderAndOpen({ showFromLink: true })

    const input = screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://example.com/file.pdf' } })
    fireEvent.click(screen.getByText(/operation\.ok/))

    expect(input.value).toBe('')
  })

  it('should toggle open state when trigger is clicked', () => {
    const trigger = (open: boolean) => <button data-testid="trigger">{open ? 'Close' : 'Open'}</button>
    render(
      <FileContextProvider value={mockFiles}>
        <FileFromLinkOrLocal trigger={trigger} fileConfig={createFileConfig()} showFromLink />
      </FileContextProvider>,
    )

    const triggerButton = screen.getByTestId('trigger')
    expect(triggerButton).toHaveTextContent('Open')

    fireEvent.click(triggerButton)

    expect(triggerButton).toHaveTextContent('Close')
  })
})
