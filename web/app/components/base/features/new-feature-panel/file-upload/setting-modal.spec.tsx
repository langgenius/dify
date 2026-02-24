import type { Features } from '../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { FeaturesProvider } from '../../context'
import FileUploadSettings from './setting-modal'

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({ data: undefined }),
}))

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: {
    enabled: true,
    allowed_file_upload_methods: [TransferMethod.local_file],
    allowed_file_types: ['image'],
    allowed_file_extensions: ['.jpg'],
    number_limits: 5,
  },
  annotationReply: { enabled: false },
}

const renderWithProvider = (ui: React.ReactNode) => {
  return render(
    <FeaturesProvider features={defaultFeatures}>
      {ui}
    </FeaturesProvider>,
  )
}

describe('FileUploadSettings (setting-modal)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children in trigger', () => {
    renderWithProvider(
      <FileUploadSettings open={false} onOpen={vi.fn()}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    expect(screen.getByText('Upload Settings')).toBeInTheDocument()
  })

  it('should render SettingContent in portal', async () => {
    renderWithProvider(
      <FileUploadSettings open={true} onOpen={vi.fn()}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    await waitFor(() => {
      expect(screen.getByText(/feature\.fileUpload\.modalTitle/)).toBeInTheDocument()
    })
  })

  it('should call onOpen with toggle function when trigger is clicked', () => {
    const onOpen = vi.fn()
    renderWithProvider(
      <FileUploadSettings open={false} onOpen={onOpen}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    fireEvent.click(screen.getByText('Upload Settings'))

    expect(onOpen).toHaveBeenCalled()
    // The toggle function should flip the open state
    const toggleFn = onOpen.mock.calls[0][0]
    expect(typeof toggleFn).toBe('function')
    expect(toggleFn(false)).toBe(true)
    expect(toggleFn(true)).toBe(false)
  })

  it('should not call onOpen when disabled', () => {
    const onOpen = vi.fn()
    renderWithProvider(
      <FileUploadSettings open={false} onOpen={onOpen} disabled>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    fireEvent.click(screen.getByText('Upload Settings'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('should call onOpen with false when cancel is clicked', async () => {
    const onOpen = vi.fn()
    renderWithProvider(
      <FileUploadSettings open={true} onOpen={onOpen}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    await waitFor(() => {
      expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /operation\.cancel/ }))

    expect(onOpen).toHaveBeenCalledWith(false)
  })

  it('should call onChange and close when save is clicked', async () => {
    const onChange = vi.fn()
    const onOpen = vi.fn()
    renderWithProvider(
      <FileUploadSettings open={true} onOpen={onOpen} onChange={onChange}>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    await waitFor(() => {
      expect(screen.getByText(/operation\.save/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /operation\.save/ }))

    expect(onChange).toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledWith(false)
  })

  it('should pass imageUpload prop to SettingContent', async () => {
    renderWithProvider(
      <FileUploadSettings open={true} onOpen={vi.fn()} imageUpload>
        <button>Upload Settings</button>
      </FileUploadSettings>,
    )

    await waitFor(() => {
      expect(screen.getByText(/feature\.imageUpload\.modalTitle/)).toBeInTheDocument()
    })
  })
})
