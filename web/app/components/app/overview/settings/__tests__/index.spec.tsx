import type { AppSiteUpdatePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement, ReactNode } from 'react'
import type { SettingsAppInfo } from '../index'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithoutPricing,
} from '@/test/console/query-data'
import { createAppSiteFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { SettingsDialog } from '../index'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD'
let copyrightEnabled = true

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

vi.mock('@/app/notifications', () => ({
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
const mockOnSave = vi.fn<(params: AppSiteUpdatePayload) => Promise<boolean>>()

vi.mock('@/context/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/context/i18n')>('@/context/i18n')
  return {
    ...actual,
    useDocLink: () => (path?: string) => `https://docs.example.com${path ?? ''}`,
  }
})

const mockAppInfo = {
  id: 'test-app',
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
} satisfies SettingsAppInfo

const triggerName = 'navigation.settings.settings'
const dialogName = 'appOverview.overview.appInfo.settings.title'

const renderSettingsDialog = async (appInfo: SettingsAppInfo = mockAppInfo, canDeploy = false) => {
  const view = render(
    <SettingsDialog isChat canDeploy={canDeploy} appInfo={appInfo} onSave={mockOnSave} />,
  )
  await userEvent.setup().click(screen.getByRole('button', { name: triggerName }))
  return view
}

const inputPlaceholderName = 'appOverview.overview.appInfo.settings.more.inputPlaceholder'

function render(...args: Parameters<typeof renderWithData>) {
  const wrap = (ui: ReactElement) => (
    <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{ui}</NuqsTestingAdapter>
  )
  args[0] = wrap(args[0])
  const result = renderWithData(...args)
  return { ...result, rerender: (ui: ReactElement) => result.rerender(wrap(ui)) }
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    toastMocks.call.mockClear()
    mockOnSave.mockReset().mockResolvedValue(true)
    onPricingUrlUpdate.mockClear()
    deploymentEdition = 'CLOUD'
    copyrightEnabled = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('edits a site with nullable optional fields as empty form values', async () => {
    await renderSettingsDialog({
      id: 'app-null-fields',
      mode: 'chat',
      site: createAppSiteFixture(),
    })

    expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toHaveValue('')
    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() =>
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'App',
          description: '',
          chat_color_theme: '',
          privacy_policy: '',
          input_placeholder: '',
          icon: null,
          icon_type: null,
          icon_background: null,
        }),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
    )
  })

  it('should render the modal with all settings exposed by default', async () => {
    await renderSettingsDialog()
    expect(screen.getByText('appOverview.overview.appInfo.settings.title')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

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

  it('should explain that Web app settings apply to every environment when ACL allows deploy', async () => {
    await renderSettingsDialog(mockAppInfo, true)

    expect(screen.getByRole('status')).toHaveTextContent(
      'appOverview.overview.appInfo.settings.multiEnvironmentNotice',
    )
  })

  it('names the Inverted switch from its visible label and exposes its state', async () => {
    const user = userEvent.setup()
    await renderSettingsDialog()

    const invertedSwitch = screen.getByRole('switch', {
      name: 'appOverview.overview.appInfo.settings.chatColorThemeInverted',
    })
    expect(invertedSwitch).toBeChecked()

    await user.click(invertedSwitch)

    expect(invertedSwitch).not.toBeChecked()
  })

  it('should notify the user when the name is empty', async () => {
    await renderSettingsDialog()
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
    await renderSettingsDialog()
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
    await renderSettingsDialog()
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
    mockOnSave.mockResolvedValueOnce(true)
    await renderSettingsDialog()

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
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
    )
  })

  it('discards cancelled edits and initializes the next session from committed settings', async () => {
    const user = userEvent.setup()
    await renderSettingsDialog()
    const placeholder = screen.getByRole('textbox', { name: inputPlaceholderName })
    await user.clear(placeholder)
    await user.type(placeholder, 'Cancelled prompt')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
    )
    expect(mockOnSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: triggerName }))
    expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toHaveValue(
      'Ask me anything',
    )
  })

  it('keeps drafts for equivalent source data and resets them when committed settings change', async () => {
    const user = userEvent.setup()
    const { rerender } = await renderSettingsDialog()
    await user.clear(screen.getByRole('textbox', { name: inputPlaceholderName }))
    await user.type(screen.getByRole('textbox', { name: inputPlaceholderName }), 'Current draft')
    rerender(
      <SettingsDialog
        isChat
        appInfo={{ ...mockAppInfo, site: { ...mockAppInfo.site } }}
        onSave={mockOnSave}
      />,
    )
    expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toHaveValue('Current draft')
    rerender(
      <SettingsDialog
        isChat
        appInfo={{
          ...mockAppInfo,
          site: { ...mockAppInfo.site, input_placeholder: 'Updated prompt' },
        }}
        onSave={mockOnSave}
      />,
    )
    expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toHaveValue(
      'Updated prompt',
    )
  })

  it.each(['false', 'rejection'] as const)(
    'retains the draft after a %s save result and permits retry',
    async (failure) => {
      const user = userEvent.setup()
      if (failure === 'false') mockOnSave.mockResolvedValueOnce(false)
      else mockOnSave.mockRejectedValueOnce(new Error('Unexpected failure'))
      await renderSettingsDialog()
      const name = screen.getByPlaceholderText('app.appNamePlaceholder')
      await user.clear(name)
      await user.type(name, 'Unsaved title')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
      expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
      expect(name).toHaveValue('Unsaved title')
      expect(toastMocks.call).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
      )
      expect(mockOnSave).toHaveBeenCalledTimes(2)
      expect(mockOnSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Unsaved title' }),
      )
    },
  )

  it('keeps the pending lock when committed metadata replaces the form draft', async () => {
    const user = userEvent.setup()
    let finishSave!: (saved: boolean) => void
    mockOnSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    const { rerender } = await renderSettingsDialog()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    rerender(
      <SettingsDialog
        isChat
        appInfo={{ ...mockAppInfo, site: { ...mockAppInfo.site, title: 'Refreshed title' } }}
        onSave={mockOnSave}
      />,
    )
    const name = screen.getByPlaceholderText('app.appNamePlaceholder')
    expect(name).toHaveValue('Refreshed title')
    expect(name).toHaveAttribute('readonly')
    await user.type(name, 'ignored')
    expect(name).toHaveValue('Refreshed title')
    expect(screen.getByRole('button', { name: 'app.iconPicker.title' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    const invertedSwitch = screen.getByRole('switch', {
      name: 'appOverview.overview.appInfo.settings.chatColorThemeInverted',
    })
    await user.click(invertedSwitch)
    expect(invertedSwitch).toBeChecked()
    const language = screen.getByRole('combobox', {
      name: 'appOverview.overview.appInfo.settings.language',
    })
    const currentLanguage = language.textContent
    await user.click(language)
    await user.click(screen.getByRole('option', { name: '简体中文' }))
    expect(language).toHaveTextContent(currentLanguage!)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.keyboard('{Escape}')
    expect(mockOnSave).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
    await act(async () => {
      finishSave(true)
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
    )
  })

  it.each(['missing-data', 'disabled'] as const)(
    'keeps an unavailable %s entry visible until ready',
    async (unavailable) => {
      const user = userEvent.setup()
      const { rerender } = render(
        <SettingsDialog
          isChat
          appInfo={unavailable === 'missing-data' ? undefined : mockAppInfo}
          disabled={unavailable === 'disabled'}
          onSave={mockOnSave}
        />,
      )
      const trigger = screen.getByRole('button', { name: triggerName })
      expect(trigger).toBeDisabled()
      await user.click(trigger)
      expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
      rerender(<SettingsDialog isChat appInfo={mockAppInfo} onSave={mockOnSave} />)
      await user.click(screen.getByRole('button', { name: triggerName }))
      expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
    },
  )

  it('keeps the open draft and blocks saving while the entry is disabled', async () => {
    const user = userEvent.setup()
    const { rerender } = await renderSettingsDialog()
    const name = screen.getByPlaceholderText('app.appNamePlaceholder')
    await user.clear(name)
    await user.type(name, 'Draft title')
    rerender(<SettingsDialog isChat appInfo={mockAppInfo} disabled onSave={mockOnSave} />)
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
    expect(name).toHaveValue('Draft title')
    const save = screen.getByRole('button', { name: 'common.operation.save' })
    expect(save).toBeDisabled()
    await user.type(name, '{Enter}')
    expect(mockOnSave).not.toHaveBeenCalled()
    rerender(<SettingsDialog isChat appInfo={mockAppInfo} onSave={mockOnSave} />)
    await user.click(save)
    expect(mockOnSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Draft title' }),
    )
  })

  it('keeps an unfinished save locked when the settings source disappears and returns', async () => {
    const user = userEvent.setup()
    let finishSave!: (saved: boolean) => void
    mockOnSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    const { rerender } = await renderSettingsDialog()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    rerender(<SettingsDialog isChat onSave={mockOnSave} />)
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
    rerender(<SettingsDialog isChat appInfo={mockAppInfo} onSave={mockOnSave} />)
    const trigger = screen.getByRole('button', { name: triggerName })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
    await act(async () => {
      finishSave(true)
    })
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
    expect(mockOnSave).toHaveBeenCalledOnce()
  })

  it('should preserve restricted settings when saving other Cloud settings', async () => {
    mockOnSave.mockResolvedValueOnce(true)
    deploymentEdition = 'CLOUD'
    copyrightEnabled = false

    await renderSettingsDialog()

    const inputPlaceholder = screen.getByRole('textbox', { name: inputPlaceholderName })
    expect(inputPlaceholder).toBeDisabled()
    expect(inputPlaceholder).toHaveValue(mockAppInfo.site.input_placeholder)
    expect(
      screen.queryByPlaceholderText(
        'appOverview.overview.appInfo.settings.more.copyRightPlaceholder',
      ),
    ).toBeDisabled()

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          copyright: undefined,
          input_placeholder: undefined,
        }),
      )
    })
  })

  it('should keep the input placeholder editable when billing is disabled', async () => {
    mockOnSave.mockResolvedValueOnce(true)
    deploymentEdition = 'COMMUNITY'
    copyrightEnabled = false

    await renderSettingsDialog()
    const inputPlaceholder = screen.getByRole('textbox', { name: inputPlaceholderName })
    fireEvent.change(inputPlaceholder, { target: { value: 'Self-hosted prompt' } })
    fireEvent.click(screen.getByText('common.operation.save'))

    expect(inputPlaceholder).toBeEnabled()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          copyright: undefined,
          input_placeholder: 'Self-hosted prompt',
        }),
      )
    })
  })

  it('should open the pricing modal from the copyright upgrade badge for sandbox plans', async () => {
    deploymentEdition = 'CLOUD'
    copyrightEnabled = false

    await renderSettingsDialog()
    fireEvent.click((await screen.findAllByText('billing.upgradeBtn.encourageShort'))[0]!)

    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })

  it('should hide the upgrade badge for non-sandbox plans', async () => {
    deploymentEdition = 'CLOUD'
    copyrightEnabled = true

    await renderSettingsDialog()
    await waitFor(() => {
      expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    })
  })

  it('should preserve image icons and apply textarea or switch changes when saving image-based settings', async () => {
    mockOnSave.mockResolvedValueOnce(true)
    const imageAppInfo = {
      ...mockAppInfo,
      site: {
        ...mockAppInfo.site,
        icon_type: 'image',
        icon: 'file-1',
        icon_background: null,
        icon_url: 'https://example.com/uploaded.png',
      },
    } satisfies SettingsAppInfo

    await renderSettingsDialog(imageAppInfo)

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

function renderWithData(
  ui: ReactElement,
  options: Parameters<typeof renderWithoutPricing>[1] = {},
) {
  return renderWithoutPricing(ui, {
    systemFeatures: { deployment_edition: deploymentEdition },
    features: { webapp_copyright_enabled: copyrightEnabled },
    ...options,
  })
}

it('saves unrelated settings while entitlements are pending without clearing protected fields', async () => {
  const queryClient = createConsoleQueryClient()
  void queryClient.query({
    ...consoleQuery.features.get.queryOptions(),
    queryFn: () => new Promise(() => {}),
  })
  const onSave = vi.fn().mockResolvedValue(true)
  render(<SettingsDialog isChat appInfo={mockAppInfo} onSave={onSave} />, {
    queryClient,
    features: undefined,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  await userEvent.setup().click(screen.getByRole('button', { name: triggerName }))
  expect(screen.getByRole('textbox', { name: inputPlaceholderName })).toBeDisabled()
  expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        copyright: undefined,
        input_placeholder: undefined,
        title: mockAppInfo.site.title,
      }),
    ),
  )
})
