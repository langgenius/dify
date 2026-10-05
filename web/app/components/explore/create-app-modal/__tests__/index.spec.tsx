import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { ReactElement } from 'react'
import type { CreateAppModalProps } from '../index'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { mockEmojiData } from '@/test/emoji-picker'
import { AppModeEnum } from '@/types/app'
import CreateAppModal from '../index'

let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'COMMUNITY'
let mockPlanType: CloudPlan = 'team'
let mockAppCount = 1
const mockAppLimit = 10

type ConfirmPayload = Parameters<CreateAppModalProps['onConfirm']>[0]

const setup = async (overrides: Partial<CreateAppModalProps> = {}) => {
  const onConfirm = vi.fn<(payload: ConfirmPayload) => Promise<void>>().mockResolvedValue(undefined)
  const onOpenChange = vi.fn()

  const props: CreateAppModalProps = {
    open: true,
    isEditModal: false,
    appName: 'Test App',
    appDescription: 'Test description',
    appIconType: 'emoji',
    appIcon: '🤖',
    appIconBackground: '#FFEAD5',
    appIconUrl: null,
    appMode: AppModeEnum.CHAT,
    appUseIconAsAnswerIcon: false,
    max_active_requests: null,
    onConfirm,
    confirmDisabled: false,
    onOpenChange,
    ...overrides,
  }

  await act(async () => {
    render(<CreateAppModal {...props} />)
  })
  return { onConfirm, onOpenChange }
}

const getAppIconTrigger = () => screen.getByRole('button', { name: 'app.iconPicker.title' })

const openAppIconPicker = () => {
  fireEvent.click(getAppIconTrigger())

  return screen.getByRole('dialog', { name: 'app.iconPicker.title' })
}

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: deploymentEdition },
    features: {
      billing: { subscription: { plan: mockPlanType } },
      apps: { size: mockAppCount, limit: mockAppLimit },
    },
  })
}

vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

async function submitWithKeyboard(
  modifier: Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey'> = { ctrlKey: true },
) {
  const target = screen.queryByPlaceholderText('app.newApp.appNamePlaceholder') ?? document.body
  await act(async () => {
    fireEvent.keyDown(target, { key: 'Enter', ...modifier })
    fireEvent.keyUp(target, { key: 'Enter', ...modifier })
  })
}

describe('CreateAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deploymentEdition = 'COMMUNITY'
    mockPlanType = 'team'
    mockAppCount = 1
  })

  it.each([
    { appIconType: null, appIcon: null, appIconBackground: null },
    {
      appIconType: 'link' as const,
      appIcon: 'https://example.com/icon.png',
      appIconBackground: null,
    },
  ])('preserves the existing icon when editing other fields: %j', async (iconProps) => {
    const user = userEvent.setup()
    const { onConfirm } = await setup({ isEditModal: true, ...iconProps })

    await user.clear(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'))
    await user.type(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), 'Renamed app')
    await user.click(screen.getByRole('button', { name: /common\.operation\.save/ }))

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Renamed app',
          icon_type: iconProps.appIconType,
          icon: iconProps.appIcon,
          icon_background: iconProps.appIconBackground,
        }),
      ),
    )
  })

  describe('Rendering', () => {
    it('should render create title and actions when creating', async () => {
      await setup({ appName: 'My App', isEditModal: false })

      expect(screen.getByText('explore.appCustomize.title:{"name":"My App"}'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.create/ }))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.cancel' }))!.toBeInTheDocument()
    })

    it('should render the submit shortcut with kbd primitives', async () => {
      await setup()

      const createButton = screen.getByRole('button', { name: /common\.operation\.create/ })
      expect(createButton.querySelectorAll('kbd')).toHaveLength(2)
    })

    it('should render edit-only fields when editing a chat app', async () => {
      await setup({ isEditModal: true, appMode: AppModeEnum.CHAT, max_active_requests: 5 })

      expect(screen.getByText('app.editAppTitle'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.save/ }))!.toBeInTheDocument()
      expect(screen.getByRole('switch'))!.toBeInTheDocument()
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('5')
    })

    it.each([AppModeEnum.ADVANCED_CHAT, AppModeEnum.AGENT_CHAT])(
      'should render answer icon switch when editing %s app',
      async (mode) => {
        await setup({ isEditModal: true, appMode: mode })

        expect(screen.getByRole('switch'))!.toBeInTheDocument()
      },
    )

    it('should not render answer icon switch when editing a non-chat app', async () => {
      await setup({ isEditModal: true, appMode: AppModeEnum.COMPLETION })

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('should not render modal content when hidden', async () => {
      await setup({ open: false })

      expect(
        screen.queryByRole('button', { name: /common\.operation\.create/ }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should disable confirm action when confirmDisabled is true', async () => {
      await setup({ confirmDisabled: true })

      expect(screen.getByRole('button', { name: /common\.operation\.create/ }))!.toBeDisabled()
    })

    it('should disable confirm action when appName is empty', async () => {
      await setup({ appName: '   ' })

      expect(screen.getByRole('button', { name: /common\.operation\.create/ }))!.toBeDisabled()
    })
  })

  describe('Edge Cases', () => {
    it('should default description to empty string when appDescription is empty', async () => {
      await setup({ appDescription: '' })

      expect(
        (screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder') as HTMLTextAreaElement)
          .value,
      ).toBe('')
    })

    it('should render i18n key placeholders when translations are available', async () => {
      await setup()

      expect((screen.getByDisplayValue('Test App') as HTMLInputElement).placeholder).toBe(
        'app.newApp.appNamePlaceholder',
      )
      expect(
        (screen.getByDisplayValue('Test description') as HTMLTextAreaElement).placeholder,
      ).toBe('app.newApp.appDescriptionPlaceholder')
    })
  })

  describe('User Interactions', () => {
    it('should call onOpenChange when cancel button is clicked', async () => {
      const { onConfirm, onOpenChange } = await setup()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  describe('Quota Gating', () => {
    it('should show AppsFull and disable create when apps quota is reached', async () => {
      deploymentEdition = 'CLOUD'
      mockPlanType = 'team'
      mockAppCount = 10

      await setup({ isEditModal: false })

      expect(screen.getByText('billing.apps.fullTip2'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.create/ }))!.toBeDisabled()
    })

    it('should allow saving when apps quota is reached in edit mode', async () => {
      deploymentEdition = 'CLOUD'
      mockPlanType = 'team'
      mockAppCount = 10

      await setup({ isEditModal: true })

      expect(screen.queryByText('billing.apps.fullTip2')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.save/ }))!.toBeEnabled()
    })
  })

  describe('Keyboard Shortcuts', () => {
    it.each([
      { platform: 'Win32', modifier: { ctrlKey: true } },
      { platform: 'MacIntel', modifier: { metaKey: true } },
    ])(
      'suspends Mod+Enter while the picker is open and resumes after it closes on $platform',
      async ({ platform, modifier }) => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
        const { onConfirm, onOpenChange } = await setup()
        const picker = openAppIconPicker()
        const pickerSearch = within(picker).getByPlaceholderText('app.iconPicker.search')
        fireEvent.keyDown(pickerSearch, { key: 'Enter', ...modifier })
        fireEvent.keyUp(pickerSearch, { key: 'Enter', ...modifier })
        expect(onConfirm).not.toHaveBeenCalled()
        expect(onOpenChange).not.toHaveBeenCalled()
        fireEvent.keyDown(pickerSearch, { key: 'Escape' })
        await waitFor(() => expect(picker).not.toBeInTheDocument())

        await submitWithKeyboard(modifier)

        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(onOpenChange).not.toHaveBeenCalled()
      },
    )

    it.each([
      { platform: 'Win32', modifier: { ctrlKey: true } },
      { platform: 'MacIntel', modifier: { metaKey: true } },
    ])(
      'keeps the shortcut available after the outer dialog is hidden with an open picker on $platform',
      async ({ platform, modifier }) => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
        const onConfirm = vi.fn().mockResolvedValue(undefined)
        const onOpenChange = vi.fn()
        const modal = (open: boolean) => (
          <CreateAppModal
            open={open}
            appName="Reopened App"
            appDescription=""
            appIconType="emoji"
            appIcon="🤖"
            onConfirm={onConfirm}
            onOpenChange={onOpenChange}
          />
        )
        const { rerender } = render(modal(true))
        const picker = openAppIconPicker()

        rerender(modal(false))
        await waitFor(() => expect(picker).not.toBeInTheDocument())
        rerender(modal(true))
        expect(
          screen.queryByRole('dialog', { name: 'app.iconPicker.title' }),
        ).not.toBeInTheDocument()
        await submitWithKeyboard(modifier)

        expect(onConfirm).toHaveBeenCalledOnce()
        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reopened App' }))
        expect(onOpenChange).not.toHaveBeenCalled()
      },
    )

    it('submits instead of opening the icon picker when Mod+Enter starts on its trigger', async () => {
      const { onConfirm } = await setup()
      const iconTrigger = getAppIconTrigger()
      iconTrigger.focus()

      fireEvent.keyDown(iconTrigger, { key: 'Enter', ctrlKey: true })
      fireEvent.keyUp(iconTrigger, { key: 'Enter', ctrlKey: true })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog', { name: 'app.iconPicker.title' })).not.toBeInTheDocument()
    })

    it('does not submit while the visible confirmation action is disabled', async () => {
      const { onConfirm, onOpenChange } = await setup({ confirmDisabled: true })
      expect(screen.getByRole('button', { name: /common\.operation\.create/ })).toBeDisabled()
      await submitWithKeyboard()
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
    })

    it('ignores shortcuts outside the dialog and during composition', async () => {
      const { onConfirm } = await setup()
      fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
      fireEvent.keyUp(document.body, { key: 'Enter', ctrlKey: true })
      const input = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
      fireEvent.keyUp(input, { key: 'Enter', ctrlKey: true })
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should not submit when modal is hidden', async () => {
      const { onConfirm, onOpenChange } = await setup({ open: false })

      await submitWithKeyboard()

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
    })

    it('should not submit when apps quota is reached in create mode', async () => {
      deploymentEdition = 'CLOUD'
      mockPlanType = 'team'
      mockAppCount = 10

      const { onConfirm, onOpenChange } = await setup({ isEditModal: false })

      await submitWithKeyboard()

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
    })

    it('should submit when apps quota is reached in edit mode', async () => {
      deploymentEdition = 'CLOUD'
      mockPlanType = 'team'
      mockAppCount = 10

      const { onConfirm, onOpenChange } = await setup({ isEditModal: true })

      await submitWithKeyboard()

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onOpenChange).not.toHaveBeenCalled()
    })

    it('should not submit when name is empty', async () => {
      const { onConfirm, onOpenChange } = await setup({ appName: '   ' })

      await submitWithKeyboard()

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
    })
  })

  describe('App Icon Picker', () => {
    it('does not fill a missing background when the picker is cancelled', async () => {
      const { onConfirm } = await setup({ appIconBackground: undefined })
      openAppIconPicker()
      await userEvent.setup().keyboard('{Escape}')
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'app.iconPicker.title' }),
        ).not.toBeInTheDocument(),
      )
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/ }))
      await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
      expect(onConfirm.mock.calls[0]![0].icon_background).toBeUndefined()
    })

    it('should open and close the picker when Escape is pressed', async () => {
      await setup({
        appIconType: 'image',
        appIcon: 'file-123',
        appIconUrl: 'https://example.com/icon.png',
      })

      const pickerDialog = openAppIconPicker()

      expect(
        within(pickerDialog).getByRole('tabpanel', { name: 'app.iconPicker.image' }),
      )!.toBeInTheDocument()

      await userEvent.setup().keyboard('{Escape}')

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'app.iconPicker.title' }),
        ).not.toBeInTheDocument()
      })
    })

    it('should update icon payload when selecting emoji and confirming', async () => {
      const { onConfirm } = await setup({
        appIconType: 'image',
        appIcon: 'file-123',
        appIconUrl: 'https://example.com/icon.png',
      })

      const pickerDialog = openAppIconPicker()

      fireEvent.click(within(pickerDialog).getByRole('tab', { name: 'app.iconPicker.emoji' }))
      fireEvent.click(await within(pickerDialog).findByRole('gridcell', { name: 'Grinning face' }))

      fireEvent.click(within(pickerDialog).getByRole('button', { name: 'app.iconPicker.ok' }))

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/ }))
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      const payload = onConfirm.mock.calls[0]![0]
      expect(payload).toMatchObject({
        icon_type: 'emoji',
        icon: '😀',
        icon_background: '#FEF3F2',
      })
    })

    it('should allow changing only the background for the current emoji icon', async () => {
      const { onConfirm } = await setup({
        appIconType: 'emoji',
        appIcon: '🤖',
        appIconBackground: '#FFEAD5',
      })
      const user = userEvent.setup()
      const pickerDialog = openAppIconPicker()
      await user.click(
        within(pickerDialog).getByRole('radio', { name: 'app.iconPicker.color.green' }),
      )
      await user.click(within(pickerDialog).getByRole('button', { name: 'app.iconPicker.ok' }))
      await user.click(screen.getByRole('button', { name: /common\.operation\.create/ }))
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(onConfirm.mock.calls[0]![0]).toMatchObject({
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#F3FEE7',
      })
    })
  })

  describe('Submitting', () => {
    it('submits its emoji payload immediately and leaves closing to the caller', async () => {
      const { onConfirm, onOpenChange } = await setup({
        appName: 'My App',
        appDescription: 'My description',
        appIconType: 'emoji',
        appIcon: '😀',
        appIconBackground: '#000000',
      })

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/ }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onOpenChange).not.toHaveBeenCalled()

      const payload = onConfirm.mock.calls[0]![0]
      expect(payload).toMatchObject({
        name: 'My App',
        icon_type: 'emoji',
        icon: '😀',
        icon_background: '#000000',
        description: 'My description',
        use_icon_as_answer_icon: false,
      })
      expect(payload).not.toHaveProperty('max_active_requests')
    })

    it('should include updated description when textarea is changed before submitting', async () => {
      const { onConfirm } = await setup({ appDescription: 'Old description' })

      fireEvent.change(screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder'), {
        target: { value: 'Updated description' },
      })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/ }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]![0]).toMatchObject({ description: 'Updated description' })
    })

    it('preserves the existing null background when submitting an unchanged image icon', async () => {
      const { onConfirm } = await setup({
        appIconType: 'image',
        appIcon: 'file-123',
        appIconUrl: 'https://example.com/icon.png',
        appIconBackground: null,
      })

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/ }))

      const payload = onConfirm.mock.calls[0]![0]
      expect(payload).toMatchObject({
        icon_type: 'image',
        icon: 'file-123',
      })
      expect(payload.icon_background).toBeNull()
    })

    it('should include max_active_requests and updated answer icon when saving', async () => {
      const { onConfirm } = await setup({
        isEditModal: true,
        appMode: AppModeEnum.CHAT,
        appUseIconAsAnswerIcon: false,
        max_active_requests: 3,
      })

      fireEvent.click(screen.getByRole('switch'))
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/ }))

      const payload = onConfirm.mock.calls[0]![0]
      expect(payload).toMatchObject({
        use_icon_as_answer_icon: true,
        max_active_requests: 12,
      })
    })

    it('should omit max_active_requests when input is empty', async () => {
      const { onConfirm } = await setup({ isEditModal: true, max_active_requests: null })

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/ }))

      const payload = onConfirm.mock.calls[0]![0]
      expect(payload.max_active_requests).toBeUndefined()
    })

    it('should omit max_active_requests when input is not a number', async () => {
      const { onConfirm } = await setup({ isEditModal: true, max_active_requests: null })

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: 'abc' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/ }))

      const payload = onConfirm.mock.calls[0]![0]
      expect(payload.max_active_requests).toBeUndefined()
    })
  })
})

it('edits an existing app without waiting for application quota data', async () => {
  const onConfirm = vi.fn()
  renderWithConsoleQuery(
    <CreateAppModal
      isEditModal
      open
      appName="Existing"
      appDescription=""
      appIconType="emoji"
      appIcon="🤖"
      onConfirm={onConfirm}
      onOpenChange={vi.fn()}
    />,
    { systemFeatures: { deployment_edition: 'CLOUD' } },
  )
  const save = screen.getByRole('button', { name: /operation.save/ })
  expect(save).toBeEnabled()
  await userEvent.setup().click(save)
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
})

it('keeps pending submissions local, preserves failed drafts and leaves successful closing to the caller', async () => {
  let rejectSave!: (error: Error) => void
  let finishSave!: () => void
  const onConfirm = vi
    .fn<(payload: ConfirmPayload) => Promise<void>>()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectSave = reject
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        }),
    )
  const onOpenChange = vi.fn()
  await setup({ isEditModal: true, onConfirm, onOpenChange, max_active_requests: 4 })
  const user = userEvent.setup()
  const name = screen.getByRole('textbox', { name: 'app.newApp.captionName' })
  const description = screen.getByRole('textbox', { name: 'app.newApp.captionDescription' })
  await user.clear(description)
  await user.type(description, 'Draft description{Enter}second line')
  expect(onConfirm).not.toHaveBeenCalled()
  await user.clear(name)
  await user.type(name, 'Draft name{Enter}')
  expect(onConfirm).toHaveBeenCalledOnce()
  expect(onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Draft name',
      description: 'Draft description\nsecond line',
      max_active_requests: 4,
    }),
  )
  expect(name).toHaveAttribute('readonly')
  expect(description).toHaveAttribute('readonly')
  expect(screen.getByRole('spinbutton')).toHaveAttribute('readonly')
  expect(getAppIconTrigger()).toBeDisabled()
  const close = screen.getByRole('button', { name: 'common.operation.close' })
  const cancel = screen.getByRole('button', { name: 'common.operation.cancel' })
  const save = screen.getByRole('button', { name: /common\.operation\.save/ })
  expect(close).toBeDisabled()
  expect(cancel).toBeDisabled()
  expect(save).toHaveAttribute('aria-disabled', 'true')
  const answerIcon = screen.getByRole('switch', { name: 'app.answerIcon.title' })
  await user.click(answerIcon)
  expect(answerIcon).not.toBeChecked()
  await user.click(close)
  await user.click(cancel)
  await user.keyboard('{Escape}')
  await submitWithKeyboard()
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(onConfirm).toHaveBeenCalledOnce()
  await act(async () => rejectSave(new Error('Save failed')))
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
  expect(name).toHaveValue('Draft name')
  expect(description).toHaveValue('Draft description\nsecond line')
  await user.click(save)
  expect(onConfirm).toHaveBeenCalledTimes(2)
  await act(async () => finishSave())
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
  expect(onOpenChange).not.toHaveBeenCalled()
  await user.click(cancel)
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
})

it('snapshots source text and icon until exit, then reopens with the current source', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn<(payload: ConfirmPayload) => Promise<void>>().mockResolvedValue(undefined)
  const props: CreateAppModalProps = {
    open: true,
    isEditModal: true,
    appName: 'Original',
    appDescription: 'Original description',
    appIconType: 'emoji',
    appIcon: '🤖',
    appIconBackground: null,
    appMode: AppModeEnum.CHAT,
    appUseIconAsAnswerIcon: true,
    max_active_requests: 3,
    onConfirm,
    onOpenChange: vi.fn(),
  }
  const { rerender } = render(<CreateAppModal {...props} />)
  const name = screen.getByRole('textbox', { name: 'app.newApp.captionName' })
  await user.clear(name)
  await user.type(name, 'Unsaved name')
  rerender(
    <CreateAppModal
      {...props}
      appName=""
      appDescription=""
      appIconType={null}
      appIcon={null}
      appUseIconAsAnswerIcon={false}
      max_active_requests={null}
    />,
  )
  expect(name).toHaveValue('Unsaved name')
  expect(screen.getByRole('textbox', { name: 'app.newApp.captionDescription' })).toHaveValue(
    'Original description',
  )
  expect(screen.getByRole('switch')).toBeChecked()
  expect(screen.getByRole('spinbutton')).toHaveValue(3)
  await user.click(screen.getByRole('button', { name: /common\.operation\.save/ }))
  expect(onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Unsaved name',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: null,
    }),
  )
  rerender(<CreateAppModal {...props} open={false} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  rerender(
    <CreateAppModal
      {...props}
      appName="Latest source"
      appDescription="Latest description"
      appIconType="image"
      appIcon="new-file"
      appIconUrl="https://example.com/new.png"
      appUseIconAsAnswerIcon={false}
      max_active_requests={8}
    />,
  )
  expect(screen.getByRole('textbox', { name: 'app.newApp.captionName' })).toHaveValue(
    'Latest source',
  )
  expect(screen.getByRole('textbox', { name: 'app.newApp.captionDescription' })).toHaveValue(
    'Latest description',
  )
  expect(screen.getByRole('switch')).not.toBeChecked()
  expect(screen.getByRole('spinbutton')).toHaveValue(8)
  await user.click(screen.getByRole('button', { name: /common\.operation\.save/ }))
  expect(onConfirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      name: 'Latest source',
      icon_type: 'image',
      icon: 'new-file',
      max_active_requests: 8,
    }),
  )
})

mockEmojiData()
