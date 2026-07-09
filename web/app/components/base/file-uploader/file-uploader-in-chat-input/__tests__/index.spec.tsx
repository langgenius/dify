import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FileContextProvider } from '../../store'
import FileUploaderInChatInput from '../index'

vi.mock('@/types/app', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/types/app')>()
  return {
    ...actual,
    TransferMethod: {
      local_file: 'local_file',
      remote_url: 'remote_url',
    },
  }
})

vi.mock('../../hooks', () => ({
  useFile: () => ({
    handleLoadFileFromLink: vi.fn(),
  }),
}))

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <FileContextProvider>
      {ui}
    </FileContextProvider>,
  )
}

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['image'],
  allowed_file_upload_methods: ['local_file', 'remote_url'],
  allowed_file_extensions: [],
  number_limits: 5,
  ...overrides,
} as unknown as FileUpload)

describe('FileUploaderInChatInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a named attachment trigger', () => {
    renderWithProvider(<FileUploaderInChatInput fileConfig={createFileConfig()} />)

    expect(screen.getByRole('button', { name: /fileUploader\.uploadFromComputer/ })).toBeInTheDocument()
  })

  it('should render FileFromLinkOrLocal when not readonly', () => {
    renderWithProvider(<FileUploaderInChatInput fileConfig={createFileConfig()} />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('should render only the trigger button when readonly', () => {
    renderWithProvider(<FileUploaderInChatInput fileConfig={createFileConfig()} readonly />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should render button with attachment icon for local_file upload method', () => {
    renderWithProvider(
      <FileUploaderInChatInput fileConfig={createFileConfig({
        allowed_file_upload_methods: ['local_file'],
      } as unknown as Partial<FileUpload>)}
      />,
    )

    const button = screen.getByRole('button', { name: /fileUploader\.uploadFromComputer/ })
    expect(button).toBeInTheDocument()
  })

  it('should render button with attachment icon for remote_url upload method', () => {
    renderWithProvider(
      <FileUploaderInChatInput fileConfig={createFileConfig({
        allowed_file_upload_methods: ['remote_url'],
      } as unknown as Partial<FileUpload>)}
      />,
    )

    const button = screen.getByRole('button', { name: /fileUploader\.uploadFromComputer/ })
    expect(button).toBeInTheDocument()
  })

  it('should keep stable focus and open-state styling on the trigger', () => {
    renderWithProvider(<FileUploaderInChatInput fileConfig={createFileConfig()} />)

    const button = screen.getByRole('button', { name: /fileUploader\.uploadFromComputer/ })
    fireEvent.click(button)

    expect(button).toHaveAttribute('data-popup-open')
  })
})
