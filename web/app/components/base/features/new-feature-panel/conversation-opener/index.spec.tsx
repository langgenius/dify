import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../../context'
import ConversationOpener from './index'

const mockSetShowOpeningModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowOpeningModal: mockSetShowOpeningModal,
  }),
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
      <ConversationOpener disabled={props.disabled} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('ConversationOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the conversation opener title', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.conversationOpener\.title/)).toBeInTheDocument()
  })

  it('should render description when not enabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.conversationOpener\.description/)).toBeInTheDocument()
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

  it('should show opening statement when enabled and not hovering', () => {
    renderWithProvider({}, {
      opening: { enabled: true, opening_statement: 'Welcome to the app!' },
    })

    expect(screen.getByText('Welcome to the app!')).toBeInTheDocument()
  })

  it('should show placeholder when enabled but no opening statement', () => {
    renderWithProvider({}, {
      opening: { enabled: true, opening_statement: '' },
    })

    expect(screen.getByText(/openingStatement\.placeholder/)).toBeInTheDocument()
  })

  it('should show edit button when hovering over enabled feature', () => {
    renderWithProvider({}, {
      opening: { enabled: true, opening_statement: 'Hello' },
    })

    const card = screen.getByText(/feature\.conversationOpener\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByText(/openingStatement\.writeOpener/)).toBeInTheDocument()
  })

  it('should open modal when edit button is clicked', () => {
    renderWithProvider({}, {
      opening: { enabled: true, opening_statement: 'Hello' },
    })

    const card = screen.getByText(/feature\.conversationOpener\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/openingStatement\.writeOpener/))

    expect(mockSetShowOpeningModal).toHaveBeenCalled()
  })

  it('should not open modal when disabled', () => {
    renderWithProvider({ disabled: true }, {
      opening: { enabled: true, opening_statement: 'Hello' },
    })

    const card = screen.getByText(/feature\.conversationOpener\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/openingStatement\.writeOpener/))

    expect(mockSetShowOpeningModal).not.toHaveBeenCalled()
  })

  it('should pass opening data to modal', () => {
    renderWithProvider({}, {
      opening: { enabled: true, opening_statement: 'Hello' },
    })

    const card = screen.getByText(/feature\.conversationOpener\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/openingStatement\.writeOpener/))

    const modalCall = mockSetShowOpeningModal.mock.calls[0][0]
    expect(modalCall.payload).toBeDefined()
    expect(modalCall.onSaveCallback).toBeDefined()
    expect(modalCall.onCancelCallback).toBeDefined()
  })

  it('should invoke onSaveCallback and update features', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange }, {
      opening: { enabled: true, opening_statement: 'Hello' },
    })

    const card = screen.getByText(/feature\.conversationOpener\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/openingStatement\.writeOpener/))

    const modalCall = mockSetShowOpeningModal.mock.calls[0][0]
    modalCall.onSaveCallback({ enabled: true, opening_statement: 'Updated' })

    expect(onChange).toHaveBeenCalled()
  })

  it('should invoke onCancelCallback', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange }, {
      opening: { enabled: true, opening_statement: 'Hello' },
    })

    const card = screen.getByText(/feature\.conversationOpener\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/openingStatement\.writeOpener/))

    const modalCall = mockSetShowOpeningModal.mock.calls[0][0]
    modalCall.onCancelCallback()

    expect(onChange).toHaveBeenCalled()
  })

  it('should show info and hide when hovering over enabled feature', () => {
    renderWithProvider({}, {
      opening: { enabled: true, opening_statement: 'Welcome!' },
    })

    // Before hover, opening statement visible
    expect(screen.getByText('Welcome!')).toBeInTheDocument()

    const card = screen.getByText(/feature\.conversationOpener\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    // After hover, button visible, statement hidden
    expect(screen.getByText(/openingStatement\.writeOpener/)).toBeInTheDocument()

    fireEvent.mouseLeave(card)

    // After leave, statement visible again
    expect(screen.getByText('Welcome!')).toBeInTheDocument()
  })
})
