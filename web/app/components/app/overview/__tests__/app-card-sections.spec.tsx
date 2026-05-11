import type { FormEvent } from 'react'
import type { AppDetailResponse } from '@/models/app'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { AppCardAccessControlSection, AppCardDialogs, AppCardOperations, AppCardUrlSection, createAppCardOperations, WorkflowLaunchDialog } from '../app-card-sections'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}))

vi.mock('../settings', () => ({
  default: () => <div data-testid="settings-modal" />,
}))

vi.mock('../embedded', () => ({
  default: () => <div data-testid="embedded-modal" />,
}))

vi.mock('../customize', () => ({
  default: () => <div data-testid="customize-modal" />,
}))

vi.mock('../../app-access-control', () => ({
  default: ({ onClose, onConfirm }: { onClose: () => void, onConfirm: () => void }) => (
    <div data-testid="access-control">
      <button type="button" onClick={onClose}>close-access</button>
      <button type="button" onClick={onConfirm}>confirm-access</button>
    </div>
  ),
}))

describe('app-card-sections', () => {
  const t = (key: string) => key

  it('should build operations with the expected disabled state', () => {
    const onLaunch = vi.fn()
    const operations = createAppCardOperations({
      operationKeys: ['launch', 'settings'],
      t: t as never,
      runningStatus: false,
      triggerModeDisabled: false,
      onLaunch,
      onEmbedded: vi.fn(),
      onCustomize: vi.fn(),
      onSettings: vi.fn(),
      onDevelop: vi.fn(),
    })

    expect(operations[0]).toMatchObject({
      key: 'launch',
      disabled: true,
      label: 'overview.appInfo.launch',
    })
    expect(operations[1]).toMatchObject({
      key: 'settings',
      disabled: false,
      label: 'overview.appInfo.settings.entry',
    })
  })

  it('should render the access-control section and call onClick', () => {
    const onClick = vi.fn()
    render(
      <AppCardAccessControlSection
        t={t as never}
        appDetail={{ access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS } as AppDetailResponse}
        isAppAccessSet={false}
        onClick={onClick}
      />,
    )

    fireEvent.click(screen.getByText('publishApp.notSet'))

    expect(screen.getByText('accessControlDialog.accessItems.specific')).toBeInTheDocument()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should render operation buttons and execute enabled actions', () => {
    const onLaunch = vi.fn()
    const onLaunchConfig = vi.fn()
    const operations = createAppCardOperations({
      operationKeys: ['launch', 'embedded'],
      t: t as never,
      runningStatus: true,
      triggerModeDisabled: false,
      onLaunch,
      onEmbedded: vi.fn(),
      onCustomize: vi.fn(),
      onSettings: vi.fn(),
      onDevelop: vi.fn(),
    })

    render(
      <AppCardOperations
        t={t as never}
        operations={operations}
        launchConfigAction={{
          label: 'operation.config',
          disabled: false,
          onClick: onLaunchConfig,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /overview\.appInfo\.launch/i }))
    fireEvent.click(screen.getByRole('button', { name: /operation\.config/i }))

    expect(onLaunch).toHaveBeenCalledTimes(1)
    expect(onLaunchConfig).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /overview\.appInfo\.embedded\.entry/i })).toBeInTheDocument()
  })

  it('should keep customize available for web app cards that are not completion or workflow apps', () => {
    const operations = createAppCardOperations({
      operationKeys: ['customize'],
      t: t as never,
      runningStatus: true,
      triggerModeDisabled: false,
      onLaunch: vi.fn(),
      onEmbedded: vi.fn(),
      onCustomize: vi.fn(),
      onSettings: vi.fn(),
      onDevelop: vi.fn(),
    })

    render(
      <AppCardOperations
        t={t as never}
        operations={operations}
      />,
    )

    expect(screen.getByText('overview.appInfo.customize.entry')).toBeInTheDocument()
    expect(AppModeEnum.CHAT).toBe('chat')
  })

  it('should invoke regenerate dialog callbacks from the url section', () => {
    const onRegenerate = vi.fn()
    const onHideRegenerateConfirm = vi.fn()

    render(
      <AppCardUrlSection
        t={t as never}
        isApp
        accessibleUrl="https://example.com/apps/demo"
        showConfirmDelete
        isCurrentWorkspaceManager
        genLoading={false}
        onRegenerate={onRegenerate}
        onShowRegenerateConfirm={vi.fn()}
        onHideRegenerateConfirm={onHideRegenerateConfirm}
      />,
    )

    const dialog = screen.getByRole('alertdialog')

    fireEvent.click(within(dialog).getByRole('button', { name: /operation\.cancel/i }))
    expect(onHideRegenerateConfirm).toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /operation\.confirm/i }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('should disable all operations when triggerModeDisabled is true', () => {
    const operations = createAppCardOperations({
      operationKeys: ['launch', 'settings'],
      t: t as never,
      runningStatus: true,
      triggerModeDisabled: true,
      onLaunch: vi.fn(),
      onEmbedded: vi.fn(),
      onCustomize: vi.fn(),
      onSettings: vi.fn(),
      onDevelop: vi.fn(),
    })

    expect(operations[0]!.disabled).toBe(true)
    expect(operations[1]!.disabled).toBe(true)
  })

  it('should render WorkflowLaunchDialog and submit values', () => {
    const onOpenChange = vi.fn()
    const onValueChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })

    render(
      <WorkflowLaunchDialog
        t={t as never}
        open
        hiddenVariables={[{
          variable: 'secret',
          label: 'Secret',
          type: InputVarType.textInput,
          hide: true,
          required: true,
        }]}
        unsupportedVariables={[]}
        values={{ secret: 'hello' }}
        onOpenChange={onOpenChange}
        onValueChange={onValueChange}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByText('overview.appInfo.workflowLaunchHiddenInputs.title')).toBeInTheDocument()
    fireEvent.submit(screen.getByRole('button', { name: /overview\.appInfo\.launch/i }).closest('form')!)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('should return null for WorkflowLaunchDialog when no variables are provided', () => {
    const { container } = render(
      <WorkflowLaunchDialog
        t={t as never}
        open
        hiddenVariables={[]}
        unsupportedVariables={[]}
        values={{}}
        onOpenChange={vi.fn()}
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('should render AppCardDialogs with all modals for web apps', () => {
    const appInfo = {
      id: 'app-1',
      mode: AppModeEnum.CHAT,
      enable_site: true,
      enable_api: false,
      site: { app_base_url: 'https://example.com', access_token: 'token-1' },
      api_base_url: 'https://api.example.com',
    } as never

    render(
      <AppCardDialogs
        isApp
        appInfo={appInfo}
        appMode={AppModeEnum.CHAT}
        showSettingsModal
        showEmbedded
        showCustomizeModal
        showAccessControl
        appDetail={{ id: 'app-1', access_mode: AccessMode.PUBLIC } as AppDetailResponse}
        onCloseSettings={vi.fn()}
        onCloseEmbedded={vi.fn()}
        onCloseCustomize={vi.fn()}
        onCloseAccessControl={vi.fn()}
        onSaveSiteConfig={vi.fn()}
        onConfirmAccessControl={vi.fn()}
      />,
    )

    expect(screen.getByTestId('settings-modal')).toBeInTheDocument()
    expect(screen.getByTestId('embedded-modal')).toBeInTheDocument()
    expect(screen.getByTestId('customize-modal')).toBeInTheDocument()
    expect(screen.getByTestId('access-control')).toBeInTheDocument()
  })

  it('should return null for AppCardDialogs when not an app', () => {
    const { container } = render(
      <AppCardDialogs
        isApp={false}
        appInfo={{} as never}
        appMode={AppModeEnum.CHAT}
        showSettingsModal={false}
        showEmbedded={false}
        showCustomizeModal={false}
        showAccessControl={false}
        appDetail={null}
        onCloseSettings={vi.fn()}
        onCloseEmbedded={vi.fn()}
        onCloseCustomize={vi.fn()}
        onCloseAccessControl={vi.fn()}
        onSaveSiteConfig={vi.fn()}
        onConfirmAccessControl={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
