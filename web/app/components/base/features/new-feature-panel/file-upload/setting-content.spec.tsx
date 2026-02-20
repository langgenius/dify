import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { FeaturesProvider } from '../../context'
import SettingContent from './setting-content'

vi.mock('@/app/components/workflow/nodes/_base/components/file-upload-setting', () => ({
  default: ({ payload, onChange }: { payload: Record<string, unknown>, onChange: (p: Record<string, unknown>) => void }) => (
    <div data-testid="file-upload-setting">
      <span data-testid="payload">{JSON.stringify(payload)}</span>
      <button
        data-testid="change-setting"
        onClick={() => onChange({
          ...payload,
          allowed_file_types: ['document'],
        })}
      >
        Change
      </button>
      <button
        data-testid="clear-file-types"
        onClick={() => onChange({
          ...payload,
          allowed_file_types: [],
        })}
      >
        Clear
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/types', () => ({
  SupportUploadFileTypes: {
    image: 'image',
  },
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

const renderWithProvider = (
  props: { imageUpload?: boolean, onClose?: () => void, onChange?: OnFeaturesChange } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <SettingContent
        imageUpload={props.imageUpload}
        onClose={props.onClose ?? vi.fn()}
        onChange={props.onChange}
      />
    </FeaturesProvider>,
  )
}

describe('SettingContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render file upload modal title', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.fileUpload\.modalTitle/)).toBeInTheDocument()
  })

  it('should render image upload modal title when imageUpload is true', () => {
    renderWithProvider({ imageUpload: true })

    expect(screen.getByText(/feature\.imageUpload\.modalTitle/)).toBeInTheDocument()
  })

  it('should render FileUploadSetting component with payload from file feature', () => {
    renderWithProvider()

    expect(screen.getByTestId('file-upload-setting')).toBeInTheDocument()
    const payload = screen.getByTestId('payload')
    expect(payload.textContent).toContain('"allowed_file_upload_methods":["local_file"]')
    expect(payload.textContent).toContain('"allowed_file_types":["image"]')
    expect(payload.textContent).toContain('"allowed_file_extensions":[".jpg"]')
    expect(payload.textContent).toContain('"max_length":5')
  })

  it('should use fallback payload values when file feature is undefined', () => {
    renderWithProvider({}, { file: undefined })

    const payload = screen.getByTestId('payload')
    expect(payload.textContent).toContain('"allowed_file_upload_methods":["local_file","remote_url"]')
    expect(payload.textContent).toContain('"allowed_file_types":["image"]')
    expect(payload.textContent).toContain('"max_length":3')
  })

  it('should render cancel and save buttons', () => {
    renderWithProvider()

    expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    expect(screen.getByText(/operation\.save/)).toBeInTheDocument()
  })

  it('should call onClose when close icon is clicked', () => {
    const onClose = vi.fn()
    renderWithProvider({ onClose })

    const closeIconButton = screen.getByTestId('close-setting-modal')
    expect(closeIconButton).toBeInTheDocument()
    if (!closeIconButton)
      throw new Error('Close icon button should exist')

    fireEvent.click(closeIconButton)

    expect(onClose).toHaveBeenCalled()
  })

  it('should call onClose when close icon receives Enter key', async () => {
    const onClose = vi.fn()
    renderWithProvider({ onClose })

    const closeIconButton = screen.getByTestId('close-setting-modal')
    closeIconButton.focus()
    await userEvent.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should call onClose when close icon receives Space key', async () => {
    const onClose = vi.fn()
    renderWithProvider({ onClose })

    const closeIconButton = screen.getByTestId('close-setting-modal')
    closeIconButton.focus()
    fireEvent.keyDown(closeIconButton, { key: ' ' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should call onClose when cancel button is clicked to close', () => {
    const onClose = vi.fn()
    renderWithProvider({ onClose })

    // Use the cancel button to test the close behavior
    fireEvent.click(screen.getByText(/operation\.cancel/))

    expect(onClose).toHaveBeenCalled()
  })

  it('should call onChange when save is clicked', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onChange).toHaveBeenCalled()
  })

  it('should not throw when save is clicked without onChange', () => {
    renderWithProvider()

    expect(() => {
      fireEvent.click(screen.getByText(/operation\.save/))
    }).not.toThrow()
  })

  it('should disable save button when allowed file types are empty', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByTestId('clear-file-types'))

    const saveButton = screen.getByRole('button', { name: /operation\.save/ })
    expect(saveButton).toBeDisabled()

    fireEvent.click(saveButton)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('should update temp payload when FileUploadSetting onChange is called', () => {
    renderWithProvider()

    // Click the change button in mock FileUploadSetting to trigger setTempPayload
    fireEvent.click(screen.getByTestId('change-setting'))

    // The payload should be updated with the new allowed_file_types
    const payload = screen.getByTestId('payload')
    expect(payload.textContent).toContain('document')
  })
})
