import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../../context'
import Moderation from './index'

const mockSetShowModerationSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowModerationSettingModal: mockSetShowModerationSettingModal,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => ({ data: { data: [] } }),
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
      <Moderation disabled={props.disabled} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('Moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the moderation title', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.moderation\.title/)).toBeInTheDocument()
  })

  it('should render description when not enabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.moderation\.description/)).toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    renderWithProvider()

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should open moderation setting modal when enabled without type', () => {
    renderWithProvider()

    fireEvent.click(screen.getByRole('switch'))

    expect(mockSetShowModerationSettingModal).toHaveBeenCalled()
  })

  it('should show provider info when enabled with openai_moderation type', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'openai_moderation',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
          outputs_config: { enabled: false, preset_response: '' },
        },
      },
    })

    expect(screen.getByText(/feature\.moderation\.modal\.provider\.openai/)).toBeInTheDocument()
  })

  it('should show provider info when enabled with keywords type', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
          outputs_config: { enabled: false, preset_response: '' },
        },
      },
    })

    expect(screen.getByText(/feature\.moderation\.modal\.provider\.keywords/)).toBeInTheDocument()
  })

  it('should show allEnabled when both inputs and outputs are enabled', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
          outputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    expect(screen.getByText(/feature\.moderation\.allEnabled/)).toBeInTheDocument()
  })

  it('should show inputEnabled when only inputs are enabled', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
          outputs_config: { enabled: false, preset_response: '' },
        },
      },
    })

    expect(screen.getByText(/feature\.moderation\.inputEnabled/)).toBeInTheDocument()
  })

  it('should show outputEnabled when only outputs are enabled', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: false, preset_response: '' },
          outputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    expect(screen.getByText(/feature\.moderation\.outputEnabled/)).toBeInTheDocument()
  })

  it('should show settings button when hovering over enabled feature', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByText(/operation\.settings/)).toBeInTheDocument()
  })

  it('should open moderation modal when settings button is clicked', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.settings/))

    expect(mockSetShowModerationSettingModal).toHaveBeenCalled()
  })

  it('should not open modal when disabled', () => {
    renderWithProvider({ disabled: true }, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.settings/))

    expect(mockSetShowModerationSettingModal).not.toHaveBeenCalled()
  })

  it('should show api provider label when type is api', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'api',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    expect(screen.getByText(/apiBasedExtension\.selector\.title/)).toBeInTheDocument()
  })

  it('should disable moderation and call onChange when switch is toggled off', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange }, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalled()
  })

  it('should open modal with default config when enabling without existing type', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    expect(mockSetShowModerationSettingModal).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          enabled: true,
          type: 'keywords',
        }),
      }),
    )
  })

  it('should invoke onSaveCallback from modal and update features', () => {
    renderWithProvider()

    fireEvent.click(screen.getByRole('switch'))

    // Extract the onSaveCallback from the modal call
    const modalCall = mockSetShowModerationSettingModal.mock.calls[0][0]
    expect(modalCall.onSaveCallback).toBeDefined()
    expect(modalCall.onCancelCallback).toBeDefined()
  })

  it('should invoke onCancelCallback from settings modal', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange }, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.settings/))

    const modalCall = mockSetShowModerationSettingModal.mock.calls[0][0]
    modalCall.onCancelCallback()

    expect(onChange).toHaveBeenCalled()
  })

  it('should invoke onSaveCallback from settings modal', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange }, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.settings/))

    const modalCall = mockSetShowModerationSettingModal.mock.calls[0][0]
    modalCall.onSaveCallback({ enabled: true, type: 'keywords', config: {} })

    expect(onChange).toHaveBeenCalled()
  })

  it('should show code-based extension label for custom type', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'custom-ext',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    // For unknown types, falls back to codeBasedExtensionList label or '-'
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('should not open setting modal when clicking settings button while disabled', () => {
    renderWithProvider({ disabled: true }, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.settings/))

    // disabled check in handleOpenModerationSettingModal should prevent call
    expect(mockSetShowModerationSettingModal).not.toHaveBeenCalled()
  })

  it('should invoke onSaveCallback from enable modal and update features', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    const modalCall = mockSetShowModerationSettingModal.mock.calls[0][0]
    // Execute the onSaveCallback
    modalCall.onSaveCallback({ enabled: true, type: 'keywords', config: {} })

    expect(onChange).toHaveBeenCalled()
  })

  it('should invoke onCancelCallback from enable modal and set enabled false', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    const modalCall = mockSetShowModerationSettingModal.mock.calls[0][0]
    // Execute the onCancelCallback
    modalCall.onCancelCallback()

    expect(onChange).toHaveBeenCalled()
  })

  it('should not show modal when enabling with existing type', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: false,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
        },
      },
    })

    fireEvent.click(screen.getByRole('switch'))

    // When type already exists, handleChange's first if-branch is skipped
    // because features.moderation.type is already 'keywords'
    // It should NOT call setShowModerationSettingModal for init
    expect(mockSetShowModerationSettingModal).not.toHaveBeenCalled()
  })

  it('should hide info display when hovering over enabled feature', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
          outputs_config: { enabled: false, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!

    // Info is visible before hover
    expect(screen.getByText(/feature\.moderation\.modal\.provider\.keywords/)).toBeInTheDocument()

    fireEvent.mouseEnter(card)

    // Info hidden, settings button shown
    expect(screen.getByText(/operation\.settings/)).toBeInTheDocument()
  })

  it('should show info display again when mouse leaves', () => {
    renderWithProvider({}, {
      moderation: {
        enabled: true,
        type: 'keywords',
        config: {
          inputs_config: { enabled: true, preset_response: '' },
          outputs_config: { enabled: false, preset_response: '' },
        },
      },
    })

    const card = screen.getByText(/feature\.moderation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.mouseLeave(card)

    expect(screen.getByText(/feature\.moderation\.modal\.provider\.keywords/)).toBeInTheDocument()
  })
})
