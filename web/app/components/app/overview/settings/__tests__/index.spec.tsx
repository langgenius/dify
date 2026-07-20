import type { ReactNode } from 'react'
import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { baseProviderContextValue } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import SettingsModal from '../index'

vi.mock('react-i18next', async () => {
  const { withSelectorKey, withSelectorKeyProps } = await import('@/test/i18n-mock')
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
        const prefix = options?.ns ? `${options.ns}.` : ''
        if (options?.returnObjects)
          return [`${prefix}${key}-feature-1`, `${prefix}${key}-feature-2`]
        return `${prefix}${key}`
      }),
      i18n: {
        language: 'en',
        changeLanguage: vi.fn(),
      },
    }),
    Trans: withSelectorKeyProps(({ children }: { children?: ReactNode }) => <>{children}</>),
  }
})

const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
const mockOnClose = vi.fn()
const mockOnSave = vi.fn()
const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
const mockUseProviderContext = vi.fn<() => ProviderContextState>()

const buildModalContext = (): ModalContextState => ({
  setShowAccountSettingModal: mockSetShowAccountSettingModal,
  setShowModerationSettingModal: vi.fn(),
  setShowExternalDataToolModal: vi.fn(),
  setShowPricingModal: mockSetShowPricingModal,
  setShowAnnotationFullModal: vi.fn(),
  setShowModelModal: vi.fn(),
  setShowExternalKnowledgeAPIModal: vi.fn(),
  setShowModelLoadBalancingModal: vi.fn(),
  setShowOpeningModal: vi.fn(),
  setShowUpdatePluginModal: vi.fn(),
  setShowEducationExpireNoticeModal: vi.fn(),
  setShowTriggerEventsLimitModal: vi.fn(),
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => buildModalContext(),
}))

vi.mock('@/context/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/context/i18n')>('@/context/i18n')
  return {
    ...actual,
    useDocLink: () => (path?: string) => `https://docs.example.com${path ?? ''}`,
  }
})

vi.mock('@/context/provider-context', async () => {
  const actual = await vi.importActual<typeof import('@/context/provider-context')>(
    '@/context/provider-context',
  )
  return {
    ...actual,
    useProviderContext: () => mockUseProviderContext(),
  }
})

const mockAppInfo = {
  site: {
    title: 'Test App',
    icon_type: 'emoji',
    icon: '😀',
    icon_background: '#ABCDEF',
    icon_url: 'https://example.com/icon.png',
    description: 'A description',
    chat_color_theme: '#123456',
    chat_color_theme_inverted: true,
    copyright: '© Dify',
    privacy_policy: '',
    custom_disclaimer: 'Disclaimer',
    input_placeholder: 'Ask me anything',
    default_language: 'en-US',
    show_workflow_steps: true,
    use_icon_as_answer_icon: true,
  },
  mode: AppModeEnum.ADVANCED_CHAT,
  enable_sso: false,
} as unknown as AppDetailResponse & Partial<AppSSO>

const renderSettingsModal = (appInfo = mockAppInfo) =>
  render(
    <SettingsModal isChat isShow appInfo={appInfo} onClose={mockOnClose} onSave={mockOnSave} />,
  )

const inputPlaceholderName = 'appOverview.overview.appInfo.settings.more.inputPlaceholder'

describe('SettingsModal', () => {
  beforeEach(() => {
    toastMocks.call.mockClear()
    mockOnClose.mockClear()
    mockOnSave.mockClear()
    mockSetShowPricingModal.mockClear()
    mockSetShowAccountSettingModal.mockClear()
    mockUseProviderContext.mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: true,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.professional,
      },
      webappCopyrightEnabled: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render the modal with all settings exposed by default', async () => {
    renderSettingsModal()
    expect(screen.getByText('appOverview.overview.appInfo.settings.title')).toBeInTheDocument()

    expect(
      screen.queryByText('appOverview.overview.appInfo.settings.more.entry'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        'appOverview.overview.appInfo.settings.more.copyRightPlaceholder',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        'appOverview.overview.appInfo.settings.more.privacyPolicyPlaceholder',
      ),
    ).toBeInTheDocument()
  })

  it('should notify the user when the name is empty', async () => {
    renderSettingsModal()
    const nameInput = screen.getByPlaceholderText('app.appNamePlaceholder')
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(toastMocks.call).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'app.newApp.nameNotEmpty' }),
      )
    })
    expect(mockOnSave).not.toHaveBeenCalled()
  })

  it('should validate the theme color and show an error when the hex is invalid', async () => {
    renderSettingsModal()
    const colorInput = screen.getByPlaceholderText('E.g #A020F0')
    fireEvent.change(colorInput, { target: { value: 'not-a-hex' } })

    fireEvent.click(screen.getByText('common.operation.save'))
    await waitFor(() => {
      expect(toastMocks.call).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'appOverview.overview.appInfo.settings.invalidHexMessage',
        }),
      )
    })
    expect(mockOnSave).not.toHaveBeenCalled()
  })

  it('should validate the privacy policy URL', async () => {
    renderSettingsModal()
    const privacyInput = screen.getByPlaceholderText(
      'appOverview.overview.appInfo.settings.more.privacyPolicyPlaceholder',
    )

    fireEvent.change(privacyInput, { target: { value: 'ftp://invalid-url' } })

    fireEvent.click(screen.getByText('common.operation.save'))
    await waitFor(() => {
      expect(toastMocks.call).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'appOverview.overview.appInfo.settings.invalidPrivacyPolicy',
        }),
      )
    })
    expect(mockOnSave).not.toHaveBeenCalled()
  })

  it('should save valid settings and close the modal', async () => {
    mockOnSave.mockResolvedValueOnce(undefined)
    renderSettingsModal()

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => expect(mockOnSave).toHaveBeenCalled())
    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: mockAppInfo.site.title,
        description: mockAppInfo.site.description,
        default_language: mockAppInfo.site.default_language,
        chat_color_theme: mockAppInfo.site.chat_color_theme,
        chat_color_theme_inverted: mockAppInfo.site.chat_color_theme_inverted,
        prompt_public: false,
        copyright: mockAppInfo.site.copyright,
        privacy_policy: mockAppInfo.site.privacy_policy,
        custom_disclaimer: mockAppInfo.site.custom_disclaimer,
        input_placeholder: mockAppInfo.site.input_placeholder,
        icon_type: 'emoji',
        icon: mockAppInfo.site.icon,
        icon_background: mockAppInfo.site.icon_background,
        show_workflow_steps: mockAppInfo.site.show_workflow_steps,
        use_icon_as_answer_icon: mockAppInfo.site.use_icon_as_answer_icon,
        enable_sso: mockAppInfo.enable_sso,
      }),
    )
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should not render a show-more trigger', () => {
    renderSettingsModal()

    expect(
      screen.queryByText('appOverview.overview.appInfo.settings.more.entry'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        'appOverview.overview.appInfo.settings.more.privacyPolicyPlaceholder',
      ),
    ).toBeInTheDocument()
  })

  it('should reset local form state when the controlled dialog reopens', () => {
    const { rerender } = render(
      <SettingsModal
        isChat
        isShow={true}
        appInfo={mockAppInfo}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />,
    )
    expect(
      screen.getByPlaceholderText(
        'appOverview.overview.appInfo.settings.more.privacyPolicyPlaceholder',
      ),
    ).toBeInTheDocument()

    rerender(
      <SettingsModal
        isChat
        isShow={false}
        appInfo={mockAppInfo}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />,
    )
    rerender(
      <SettingsModal
        isChat
        isShow={true}
        appInfo={mockAppInfo}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />,
    )

    expect(
      screen.queryByText('appOverview.overview.appInfo.settings.more.entry'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        'appOverview.overview.appInfo.settings.more.privacyPolicyPlaceholder',
      ),
    ).toBeInTheDocument()
  })

  it('should reset the input placeholder when app info changes while open', () => {
    const { rerender } = render(
      <SettingsModal
        isChat
        isShow={true}
        appInfo={mockAppInfo}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />,
    )
    expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toHaveValue(
      'Ask me anything',
    )

    rerender(
      <SettingsModal
        isChat
        isShow={true}
        appInfo={
          {
            ...mockAppInfo,
            site: {
              ...mockAppInfo.site,
              input_placeholder: 'Updated prompt',
            },
          } as typeof mockAppInfo
        }
        onClose={mockOnClose}
        onSave={mockOnSave}
      />,
    )
    expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toHaveValue(
      'Updated prompt',
    )
  })

  it('should display paid webapp settings as defaults for Cloud sandbox plans', async () => {
    mockOnSave.mockResolvedValueOnce(undefined)
    mockUseProviderContext.mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: true,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.sandbox,
      },
      webappCopyrightEnabled: true,
    })

    renderSettingsModal()

    const inputPlaceholder = screen.getByRole('textbox', { name: inputPlaceholderName })
    expect(inputPlaceholder).toBeDisabled()
    expect(inputPlaceholder).toHaveValue('')
    expect(
      screen.queryByPlaceholderText(
        'appOverview.overview.appInfo.settings.more.copyRightPlaceholder',
      ),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          copyright: '',
          input_placeholder: '',
        }),
      )
    })
  })

  it('should keep the input placeholder editable when billing is disabled', async () => {
    mockOnSave.mockResolvedValueOnce(undefined)
    mockUseProviderContext.mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: false,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.sandbox,
      },
      webappCopyrightEnabled: false,
    })

    renderSettingsModal()
    const inputPlaceholder = screen.getByRole('textbox', { name: inputPlaceholderName })
    fireEvent.change(inputPlaceholder, { target: { value: 'Self-hosted prompt' } })
    fireEvent.click(screen.getByText('common.operation.save'))

    expect(inputPlaceholder).toBeEnabled()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          copyright: '',
          input_placeholder: 'Self-hosted prompt',
        }),
      )
    })
  })

  it('should open the pricing modal from the copyright upgrade badge for sandbox plans', async () => {
    mockUseProviderContext.mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: true,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.sandbox,
      },
      webappCopyrightEnabled: false,
    })

    renderSettingsModal()
    fireEvent.click((await screen.findAllByText('billing.upgradeBtn.encourageShort'))[0]!)

    expect(mockSetShowPricingModal).toHaveBeenCalled()
    expect(mockSetShowAccountSettingModal).not.toHaveBeenCalled()
  })

  it('should hide the upgrade badge for non-sandbox plans', async () => {
    mockUseProviderContext.mockReturnValue({
      ...baseProviderContextValue,
      enableBilling: true,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.professional,
      },
      webappCopyrightEnabled: true,
    })

    renderSettingsModal()
    await waitFor(() => {
      expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    })
  })

  it('should preserve image icons and apply textarea or switch changes when saving image-based settings', async () => {
    mockOnSave.mockResolvedValueOnce(undefined)
    const imageAppInfo = {
      ...mockAppInfo,
      site: {
        ...mockAppInfo.site,
        icon_type: 'image',
        icon: 'file-1',
        icon_background: null,
        icon_url: 'https://example.com/uploaded.png',
      },
    } as typeof mockAppInfo

    renderSettingsModal(imageAppInfo)

    fireEvent.change(screen.getByDisplayValue('A description'), {
      target: { value: 'Updated description' },
    })
    fireEvent.change(screen.getByPlaceholderText('E.g #A020F0'), {
      target: { value: '' },
    })

    const switches = screen.getAllByRole('switch')
    switches.forEach((toggle) => {
      fireEvent.click(toggle)
    })

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Updated description',
          chat_color_theme: '',
          chat_color_theme_inverted: false,
          copyright: '',
          icon_type: 'image',
          icon: 'file-1',
          icon_background: undefined,
          show_workflow_steps: false,
          use_icon_as_answer_icon: false,
        }),
      )
    })
  })
})
