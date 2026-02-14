import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../../context'
import ImageUpload from './index'

vi.mock('@/app/components/base/features/new-feature-panel/file-upload/setting-modal', () => ({
  default: ({ children, open, onOpen, imageUpload }: { children: React.ReactNode, open: boolean, onOpen: (v: boolean) => void, imageUpload?: boolean }) => (
    <div data-testid="setting-modal" data-open={open} data-image-upload={imageUpload}>
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
      <ImageUpload disabled={props.disabled ?? false} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('ImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the image upload title', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.imageUpload\.title/)).toBeInTheDocument()
  })

  it('should render LEGACY badge', () => {
    renderWithProvider()

    expect(screen.getByText('LEGACY')).toBeInTheDocument()
  })

  it('should render description when disabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.imageUpload\.description/)).toBeInTheDocument()
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
        allowed_file_types: ['image'],
        number_limits: 3,
      },
    })

    expect(screen.getByText('image')).toBeInTheDocument()
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

  it('should show settings button when hovering', () => {
    renderWithProvider({}, {
      file: { enabled: true },
    })

    const card = screen.getByText(/feature\.imageUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByText(/operation\.settings/)).toBeInTheDocument()
  })

  it('should show setting modal with imageUpload prop on hover', () => {
    renderWithProvider({}, {
      file: { enabled: true },
    })

    const card = screen.getByText(/feature\.imageUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByTestId('setting-modal')).toHaveAttribute('data-image-upload', 'true')
  })

  it('should show supported types and number limit labels when enabled', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        number_limits: 3,
      },
    })

    expect(screen.getByText(/feature\.imageUpload\.supportedTypes/)).toBeInTheDocument()
    expect(screen.getByText(/feature\.imageUpload\.numberLimit/)).toBeInTheDocument()
  })

  it('should hide info display when hovering', () => {
    renderWithProvider({}, {
      file: {
        enabled: true,
        allowed_file_types: ['image'],
        number_limits: 3,
      },
    })

    const card = screen.getByText(/feature\.imageUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.queryByText(/feature\.imageUpload\.supportedTypes/)).not.toBeInTheDocument()
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

    const card = screen.getByText(/feature\.imageUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.mouseLeave(card)

    expect(screen.getByText(/feature\.imageUpload\.supportedTypes/)).toBeInTheDocument()
  })

  it('should show dash when no file types configured', () => {
    renderWithProvider({}, {
      file: { enabled: true },
    })

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('should call onOpen callback with false when close-modal is clicked', () => {
    renderWithProvider({}, {
      file: { enabled: true },
    })

    const card = screen.getByText(/feature\.imageUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    fireEvent.click(screen.getByTestId('close-modal'))

    expect(screen.queryByTestId('setting-modal')).not.toBeInTheDocument()
  })
})
