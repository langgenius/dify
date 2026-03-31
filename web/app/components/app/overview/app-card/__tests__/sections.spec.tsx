import type { AppDetailResponse } from '@/models/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import {
  AppCardAccessSection,
  AppCardAddressSection,
  AppCardDisabledOverlay,
  AppCardHeader,
  AppCardOperations,
} from '../sections'

const mockWindowOpen = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValueOrOptions?: unknown, maybeOptions?: { ns?: string }) => {
      const options = typeof defaultValueOrOptions === 'object' && defaultValueOrOptions && 'ns' in (defaultValueOrOptions as object)
        ? defaultValueOrOptions as { ns?: string }
        : maybeOptions

      return options?.ns ? `${options.ns}.${key}` : key
    },
  }),
}))

vi.mock('@/app/components/app-sidebar/basic', () => ({
  default: ({ name, type }: { name: string, type: string }) => (
    <div data-testid="app-basic">
      <div>{name}</div>
      <div>{type}</div>
    </div>
  ),
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/base/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean, children: React.ReactNode }) => open ? <>{children}</> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogActions: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogCancelButton: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  AlertDialogConfirmButton: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@/app/components/develop/secret-key/secret-key-button', () => ({
  default: ({ appId }: { appId: string }) => <div>{`secret-key:${appId}`}</div>,
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div>{`indicator:${color}`}</div>,
}))

const createAppInfo = (overrides: Partial<AppDetailResponse> = {}): AppDetailResponse => ({
  access_mode: AccessMode.PUBLIC,
  api_base_url: 'https://api.example.com',
  enable_api: true,
  enable_site: true,
  icon: '🤖',
  icon_background: '#ffffff',
  icon_type: 'emoji',
  id: 'app-1',
  mode: AppModeEnum.CHAT,
  name: 'Test app',
  site: {
    app_base_url: 'https://apps.example.com',
    access_token: 'token-123',
  },
  ...overrides,
} as AppDetailResponse)

describe('app-card-sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.open = mockWindowOpen as unknown as typeof window.open
  })

  it('should render disabled overlays with and without messages', () => {
    const { container, rerender } = render(<AppCardDisabledOverlay triggerModeDisabled />)

    expect(container.querySelector('.cursor-not-allowed')).toBeInTheDocument()

    rerender(
      <AppCardDisabledOverlay
        triggerModeDisabled
        triggerModeMessage={<span>blocked-message</span>}
      />,
    )

    expect(screen.getByText('blocked-message')).toBeInTheDocument()
  })

  it('should open the learn-more link from the disabled header tooltip', () => {
    render(
      <AppCardHeader
        appInfo={createAppInfo({
          mode: AppModeEnum.WORKFLOW,
        })}
        basicDescription="description"
        basicName="title"
        cardType="webapp"
        learnMoreUrl="https://docs.example.com/use-dify/nodes/user-input"
        runningStatus={false}
        toggleDisabled
        triggerModeDisabled={false}
        appUnpublished
        missingStartNode={false}
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    fireEvent.click(screen.getByText('appOverview.overview.appInfo.enableTooltip.learnMore'))

    expect(mockWindowOpen).toHaveBeenCalledWith('https://docs.example.com/use-dify/nodes/user-input', '_blank')
  })

  it('should render api addresses without regenerate controls and handle webapp regenerate actions', () => {
    const onCloseRegenerateDialog = vi.fn()
    const onConfirmRegenerate = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <AppCardAddressSection
        addressLabel="address"
        apiUrl="https://api.example.com"
        appUrl="https://apps.example.com/app/chat/token-123"
        genLoading={false}
        isApp={false}
        isCurrentWorkspaceManager={false}
        isRegenerateDialogOpen={false}
        onCloseRegenerateDialog={onCloseRegenerateDialog}
        onConfirmRegenerate={onConfirmRegenerate}
        onOpenRegenerateDialog={vi.fn()}
      />,
    )

    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /appOverview\.overview\.appInfo\.regenerate/i })).not.toBeInTheDocument()

    rerender(
      <AppCardAddressSection
        addressLabel="address"
        apiUrl="https://api.example.com"
        appUrl="https://apps.example.com/app/chat/token-123"
        genLoading={false}
        isApp
        isCurrentWorkspaceManager
        isRegenerateDialogOpen
        onCloseRegenerateDialog={onCloseRegenerateDialog}
        onConfirmRegenerate={onConfirmRegenerate}
        onOpenRegenerateDialog={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))

    expect(onCloseRegenerateDialog).toHaveBeenCalledTimes(1)
    expect(onConfirmRegenerate).toHaveBeenCalledTimes(1)
  })

  it('should render access warnings and api operations', () => {
    const onOperationSelect = vi.fn()

    render(
      <>
        <AppCardAccessSection
          iconClassName="i-ri-lock-line"
          isAppAccessSet={false}
          label="private-access"
          onClick={vi.fn()}
        />
        <AppCardOperations
          appId="app-1"
          isApp={false}
          operations={[
            { key: 'doc', label: 'Doc', iconClassName: 'i-ri-book-open-line', disabled: false },
            { key: 'launch', label: 'Launch', iconClassName: 'i-ri-external-link-line', disabled: true },
          ]}
          onOperationSelect={onOperationSelect}
        />
      </>,
    )

    expect(screen.getByText('app.publishApp.notSet')).toBeInTheDocument()
    expect(screen.getByText('secret-key:app-1')).toBeInTheDocument()
    expect(screen.getByText('appOverview.overview.appInfo.preUseReminder')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Doc/i }))

    expect(onOperationSelect).toHaveBeenCalledWith('doc')
  })
})
