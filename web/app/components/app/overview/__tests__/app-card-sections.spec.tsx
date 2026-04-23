import type { AppDetailResponse } from '@/models/app'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { AppCardAccessControlSection, AppCardOperations, AppCardUrlSection, createAppCardOperations } from '../app-card-sections'

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
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /overview\.appInfo\.launch/i }))

    expect(onLaunch).toHaveBeenCalledTimes(1)
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
})
