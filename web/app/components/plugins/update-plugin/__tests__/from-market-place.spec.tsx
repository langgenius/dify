import type { UpdateFromMarketPlacePayload } from '@/app/components/plugins/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, TaskStatus } from '@/app/components/plugins/types'
import UpdateFromMarketplace from '../from-market-place'

const {
  mockStop,
  mockCheck,
  mockHandleRefetch,
  mockInvalidateReferenceSettings,
  mockRemoveAutoUpgrade,
  mockUpdateFromMarketPlace,
  mockToastError,
} = vi.hoisted(() => ({
  mockStop: vi.fn(),
  mockCheck: vi.fn(),
  mockHandleRefetch: vi.fn(),
  mockInvalidateReferenceSettings: vi.fn(),
  mockRemoveAutoUpgrade: vi.fn(),
  mockUpdateFromMarketPlace: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogCloseButton: () => <button>close dialog</button>,
}))

vi.mock('@/app/components/base/badge/index', () => ({
  __esModule: true,
  BadgeState: {
    Warning: 'warning',
  },
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/base/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ titleLeft, payload }: { titleLeft: React.ReactNode, payload: { label: Record<string, string> } }) => (
    <div data-testid="plugin-card">
      <div>{payload.label.en_US}</div>
      <div>{titleLeft}</div>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/base/check-task-status', () => ({
  default: () => ({
    check: mockCheck,
    stop: mockStop,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/utils', () => ({
  pluginManifestToCardPluginProps: (payload: unknown) => payload,
}))

vi.mock('@/service/plugins', () => ({
  updateFromMarketPlace: mockUpdateFromMarketPlace,
}))

vi.mock('@/service/use-plugins', () => ({
  usePluginTaskList: () => ({
    handleRefetch: mockHandleRefetch,
  }),
  useRemoveAutoUpgrade: () => ({
    mutateAsync: mockRemoveAutoUpgrade,
  }),
  useInvalidateReferenceSettings: () => mockInvalidateReferenceSettings,
}))

vi.mock('../install-plugin/base/use-get-icon', () => ({
  default: () => ({
    getIconUrl: async (icon: string) => `https://cdn.example.com/${icon}`,
  }),
}))

vi.mock('../downgrade-warning', () => ({
  default: ({
    onCancel,
    onJustDowngrade,
    onExcludeAndDowngrade,
  }: {
    onCancel: () => void
    onJustDowngrade: () => void
    onExcludeAndDowngrade: () => void
  }) => (
    <div data-testid="downgrade-warning">
      <button onClick={onCancel}>cancel downgrade</button>
      <button onClick={onJustDowngrade}>downgrade only</button>
      <button onClick={onExcludeAndDowngrade}>exclude and downgrade</button>
    </div>
  ),
}))

const createPayload = (overrides: Partial<UpdateFromMarketPlacePayload> = {}): UpdateFromMarketPlacePayload => ({
  category: PluginCategoryEnum.tool,
  originalPackageInfo: {
    id: 'plugin@1.0.0',
    payload: {
      version: '1.0.0',
      icon: 'plugin.png',
      label: { en_US: 'Plugin Label' },
    } as UpdateFromMarketPlacePayload['originalPackageInfo']['payload'],
  },
  targetPackageInfo: {
    id: 'plugin@2.0.0',
    version: '2.0.0',
  },
  ...overrides,
})

describe('UpdateFromMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheck.mockResolvedValue({ status: TaskStatus.success })
    mockUpdateFromMarketPlace.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
  })

  it('renders the upgrade modal content and current version transition', async () => {
    render(
      <UpdateFromMarketplace
        payload={createPayload()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('plugin.upgrade.title')).toBeInTheDocument()
    expect(screen.getByText('plugin.upgrade.description')).toBeInTheDocument()
    expect(screen.getByText('1.0.0 -> 2.0.0')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('plugin-card')).toHaveTextContent('Plugin Label')
    })
  })

  it('submits the marketplace upgrade and calls onSave when installation is immediate', async () => {
    const onSave = vi.fn()
    render(
      <UpdateFromMarketplace
        payload={createPayload()}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('plugin.upgrade.upgrade'))

    await waitFor(() => {
      expect(mockUpdateFromMarketPlace).toHaveBeenCalledWith({
        original_plugin_unique_identifier: 'plugin@1.0.0',
        new_plugin_unique_identifier: 'plugin@2.0.0',
      })
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('surfaces failed upgrade messages from the response task payload', async () => {
    mockUpdateFromMarketPlace.mockResolvedValue({
      task: {
        status: TaskStatus.failed,
        plugins: [{
          plugin_unique_identifier: 'plugin@2.0.0',
          message: 'upgrade failed',
        }],
      },
    })

    render(
      <UpdateFromMarketplace
        payload={createPayload()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('plugin.upgrade.upgrade'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('upgrade failed')
    })
  })

  it('removes auto-upgrade before downgrading when the warning modal is shown', async () => {
    render(
      <UpdateFromMarketplace
        payload={createPayload()}
        pluginId="plugin-1"
        onSave={vi.fn()}
        onCancel={vi.fn()}
        isShowDowngradeWarningModal
      />,
    )

    fireEvent.click(screen.getByText('exclude and downgrade'))

    await waitFor(() => {
      expect(mockRemoveAutoUpgrade).toHaveBeenCalledWith({ plugin_id: 'plugin-1' })
      expect(mockInvalidateReferenceSettings).toHaveBeenCalled()
      expect(mockUpdateFromMarketPlace).toHaveBeenCalled()
    })
  })
})
