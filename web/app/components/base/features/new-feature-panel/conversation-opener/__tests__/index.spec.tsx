import type { Features, OnFeaturesChange } from '../../../types'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesContext, FeaturesProvider } from '../../../context'
import { createFeaturesStore } from '../../../store'
import ConversationOpener from '../index'

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
  props: { disabled?: boolean; onChange?: OnFeaturesChange } = {},
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

  it('should render description when not enabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.conversationOpener\.description/))!.toBeInTheDocument()
  })

  it('should call onChange when toggled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    await user.click(screen.getByRole('switch'))

    expect(screen.getByRole('switch')).toBeChecked()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('should show opening statement when enabled and not hovering', () => {
    renderWithProvider(
      {},
      {
        opening: { enabled: true, opening_statement: 'Welcome to the app!' },
      },
    )

    expect(screen.getByText('Welcome to the app!'))!.toBeInTheDocument()
  })

  it('should show placeholder when enabled but no opening statement', () => {
    renderWithProvider(
      {},
      {
        opening: { enabled: true, opening_statement: '' },
      },
    )

    expect(screen.getByText(/openingStatement\.placeholder/))!.toBeInTheDocument()
  })

  it('should not open modal when disabled', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      { disabled: true },
      {
        opening: { enabled: true, opening_statement: 'Hello' },
      },
    )

    const card = screen.getByText(/feature\.conversationOpener\.title/)
    await user.hover(card)
    screen.getByRole('button', { name: /openingStatement\.writeOpener/ }).focus()
    await user.keyboard('{Enter}')

    expect(mockSetShowOpeningModal).not.toHaveBeenCalled()
  })

  it('should invoke onSaveCallback and update features', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProvider(
      { onChange },
      {
        opening: { enabled: true, opening_statement: 'Hello' },
      },
    )

    const card = screen.getByText(/feature\.conversationOpener\.title/)
    await user.hover(card)
    screen.getByRole('button', { name: /openingStatement\.writeOpener/ }).focus()
    await user.keyboard('{Enter}')

    const modalCall = mockSetShowOpeningModal.mock.calls[0]![0]
    expect(modalCall.payload).toEqual(
      expect.objectContaining({ enabled: true, opening_statement: 'Hello' }),
    )
    act(() => {
      modalCall.onSaveCallback({ enabled: true, opening_statement: 'Updated' })
    })

    await user.hover(document.body)
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('preserves other feature changes made while the modal is open', async () => {
    const user = userEvent.setup()
    const store = createFeaturesStore()
    store.getState().setFeatures({
      ...store.getState().features,
      opening: { enabled: true, opening_statement: 'Hello' },
    })
    render(
      <FeaturesContext value={store}>
        <ConversationOpener />
      </FeaturesContext>,
    )

    await user.hover(screen.getByText(/feature\.conversationOpener\.title/))
    screen.getByRole('button', { name: /openingStatement\.writeOpener/ }).focus()
    await user.keyboard('{Enter}')
    act(() =>
      store.getState().setFeatures({
        ...store.getState().features,
        file: { enabled: true, number_limits: 10 },
      }),
    )
    const updated = { enabled: true, opening_statement: 'Updated' }
    act(() => mockSetShowOpeningModal.mock.calls[0]![0].onSaveCallback(updated))

    expect(store.getState().features).toMatchObject({
      opening: updated,
      file: { enabled: true, number_limits: 10 },
    })
  })

  it('should invoke onCancelCallback', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProvider(
      { onChange },
      {
        opening: { enabled: true, opening_statement: 'Hello' },
      },
    )

    const card = screen.getByText(/feature\.conversationOpener\.title/)
    await user.hover(card)
    screen.getByRole('button', { name: /openingStatement\.writeOpener/ }).focus()
    await user.keyboard('{Enter}')

    const modalCall = mockSetShowOpeningModal.mock.calls[0]![0]
    modalCall.onCancelCallback()
    await user.hover(document.body)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('should show info and hide when hovering over enabled feature', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      {},
      {
        opening: { enabled: true, opening_statement: 'Welcome!' },
      },
    )

    expect(screen.getByText('Welcome!'))!.toBeInTheDocument()

    const card = screen.getByText(/feature\.conversationOpener\.title/)
    await user.hover(card)

    expect(screen.getByText(/openingStatement\.writeOpener/))!.toBeInTheDocument()

    await user.hover(document.body)

    expect(screen.getByText('Welcome!'))!.toBeInTheDocument()
  })
})
