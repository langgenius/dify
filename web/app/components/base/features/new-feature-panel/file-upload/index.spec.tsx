import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../../context'
import FileUpload from './index'

vi.mock('@/app/components/base/features/new-feature-panel/file-upload/setting-modal', () => ({
  default: ({ children, open, onOpen }: { children: React.ReactNode, open: boolean, onOpen: (v: boolean) => void }) => (
    <div data-testid="setting-modal" data-open={open}>
      {children}
      <button data-testid="close-modal" onClick={() => onOpen(false)}>Close</button>
    </div>
  ),
}))

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

const renderWithProvider = (
  props: { disabled?: boolean, onChange?: OnFeaturesChange } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <FileUpload disabled={props.disabled ?? false} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('FileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the file upload title', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.fileUpload\.title/)).toBeInTheDocument()
  })

  it('should render description when disabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.fileUpload\.description/)).toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    renderWithProvider()

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should call onChange when toggled', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalled()
  })

  it('should show supported types when enabled', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
        allowed_file_types: ['image', 'document'],
        number_limits: 5,
      },
    })

    expect(screen.getByText('image,document')).toBeInTheDocument()
  })

  it('should show number limits when enabled', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        number_limits: 3,
      },
    })

    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('should show dash when no allowed file types', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
      },
    })

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('should show settings button when hovering', () => {
    renderWithProvider({}, {
      file: { enabled: true },
    })

    const card = screen.getByText(/feature\.fileUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByText(/operation\.settings/)).toBeInTheDocument()
  })

  it('should show setting modal on hover', () => {
    renderWithProvider({}, {
      file: { enabled: true },
    })

    const card = screen.getByText(/feature\.fileUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByTestId('setting-modal')).toBeInTheDocument()
  })

  it('should show supported types label when enabled', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        number_limits: 3,
      },
    })

    expect(screen.getByText(/feature\.fileUpload\.supportedTypes/)).toBeInTheDocument()
    expect(screen.getByText(/feature\.fileUpload\.numberLimit/)).toBeInTheDocument()
  })

  it('should hide info display when hovering over enabled feature', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        number_limits: 3,
      },
    })

    const card = screen.getByText(/feature\.fileUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    // Info display should be hidden, settings button should appear
    expect(screen.queryByText(/feature\.fileUpload\.supportedTypes/)).not.toBeInTheDocument()
    expect(screen.getByText(/operation\.settings/)).toBeInTheDocument()
  })

  it('should show info display again when mouse leaves', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        number_limits: 3,
      },
    })

    const card = screen.getByText(/feature\.fileUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.mouseLeave(card)

    expect(screen.getByText(/feature\.fileUpload\.supportedTypes/)).toBeInTheDocument()
  })

  it('should call onOpen callback with false when close-modal is clicked', () => {
    renderWithProvider({}, {
      file: { enabled: true },
    })

    const card = screen.getByText(/feature\.fileUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    // Click close button triggers onOpen(false) which calls setModalOpen(false) and setIsHovering(false)
    fireEvent.click(screen.getByTestId('close-modal'))

    // After close, info display should be shown since isHovering was set to false
    // The SettingModal should unmount since both isHovering and modalOpen are false
    expect(screen.queryByTestId('setting-modal')).not.toBeInTheDocument()
  })
})
