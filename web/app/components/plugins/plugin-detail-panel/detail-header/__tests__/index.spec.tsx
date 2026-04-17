import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import DetailHeader from '../index'

const mockSetTargetVersion = vi.fn()
const mockSetVersionPickerOpen = vi.fn()
const mockHandleUpdate = vi.fn()
const mockHandleUpdatedFromMarketplace = vi.fn()
const mockHandleDelete = vi.fn()

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { timezone: 'UTC' },
  }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
  useLocale: () => 'en-US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({
    data: [{
      name: 'tool-plugin/provider-a',
      type: 'builtin',
      allow_delete: true,
    }],
  }),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.example.com${path}`,
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ onClick, children }: { onClick?: () => void, children: React.ReactNode }) => (
    <button data-testid="close-button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/badge', () => ({
  default: ({ text, children }: { text?: React.ReactNode, children?: React.ReactNode }) => (
    <div data-testid="badge">{text ?? children}</div>
  ),
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AuthCategory: {
    tool: 'tool',
  },
  PluginAuth: ({ pluginPayload }: { pluginPayload: { provider: string } }) => (
    <div data-testid="plugin-auth">{pluginPayload.provider}</div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/operation-dropdown', () => ({
  default: ({ detailUrl }: { detailUrl: string }) => <div data-testid="operation-dropdown">{detailUrl}</div>,
}))

vi.mock('@/app/components/plugins/update-plugin/plugin-version-picker', () => ({
  default: ({ onSelect, trigger }: {
    onSelect: (value: { version: string, unique_identifier: string, isDowngrade?: boolean }) => void
    trigger: React.ReactNode
  }) => (
    <div>
      {trigger}
      <button
        data-testid="version-select"
        onClick={() => onSelect({ version: '2.0.0', unique_identifier: 'uid-2', isDowngrade: true })}
      >
        select version
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/base/badges/verified', () => ({
  default: () => <div data-testid="verified" />,
}))

vi.mock('@/app/components/base/deprecation-notice', () => ({
  default: () => <div data-testid="deprecation-notice" />,
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="card-icon">{src}</div>,
}))

vi.mock('@/app/components/plugins/card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

vi.mock('@/app/components/plugins/card/base/org-info', () => ({
  default: ({ orgName }: { orgName: string }) => <div data-testid="org-info">{orgName}</div>,
}))

vi.mock('@/app/components/plugins/card/base/title', () => ({
  default: ({ title }: { title: string }) => <div data-testid="title">{title}</div>,
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  default: () => ({
    referenceSetting: {
      auto_upgrade: {
        upgrade_time_of_day: 0,
      },
    },
  }),
}))

vi.mock('@/app/components/plugins/reference-setting-modal/auto-update-setting/utils', () => ({
  convertUTCDaySecondsToLocalSeconds: (value: number) => value,
  timeOfDayToDayjs: () => ({
    format: () => '10:00 AM',
  }),
}))

vi.mock('../components', () => ({
  HeaderModals: () => <div data-testid="header-modals" />,
  PluginSourceBadge: ({ source }: { source: string }) => <div data-testid="source-badge">{source}</div>,
}))

vi.mock('../hooks', () => ({
  useDetailHeaderState: () => ({
    modalStates: {
      isShowUpdateModal: false,
      showUpdateModal: vi.fn(),
      hideUpdateModal: vi.fn(),
      isShowPluginInfo: false,
      showPluginInfo: vi.fn(),
      hidePluginInfo: vi.fn(),
      isShowDeleteConfirm: false,
      showDeleteConfirm: vi.fn(),
      hideDeleteConfirm: vi.fn(),
      deleting: false,
      showDeleting: vi.fn(),
      hideDeleting: vi.fn(),
    },
    versionPicker: {
      isShow: false,
      setIsShow: mockSetVersionPickerOpen,
      targetVersion: {
        version: '1.0.0',
        unique_identifier: 'uid-1',
      },
      setTargetVersion: mockSetTargetVersion,
      isDowngrade: false,
      setIsDowngrade: vi.fn(),
    },
    hasNewVersion: true,
    isAutoUpgradeEnabled: true,
    isFromGitHub: false,
    isFromMarketplace: true,
  }),
  usePluginOperations: () => ({
    handleUpdate: mockHandleUpdate,
    handleUpdatedFromMarketplace: mockHandleUpdatedFromMarketplace,
    handleDelete: mockHandleDelete,
  }),
}))

const createDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'tool-plugin',
  plugin_id: 'tool-plugin',
  plugin_unique_identifier: 'tool-plugin@1.0.0',
  declaration: {
    author: 'acme',
    category: PluginCategoryEnum.tool,
    name: 'provider-a',
    label: { en_US: 'Tool Plugin' },
    description: { en_US: 'Tool plugin description' },
    icon: 'icon.png',
    icon_dark: 'icon-dark.png',
    verified: true,
    tool: {
      identity: {
        name: 'provider-a',
      },
    },
  } as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '2.0.0',
  latest_unique_identifier: 'uid-2',
  source: PluginSource.marketplace,
  status: 'active',
  deprecated_reason: 'Deprecated',
  alternative_plugin_id: 'plugin-2',
  meta: undefined,
  ...overrides,
}) as PluginDetail

describe('DetailHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the plugin summary, source badge, auth section, and modal container', () => {
    render(<DetailHeader detail={createDetail()} onHide={vi.fn()} onUpdate={vi.fn()} />)

    expect(screen.getByTestId('title')).toHaveTextContent('Tool Plugin')
    expect(screen.getByTestId('description')).toHaveTextContent('Tool plugin description')
    expect(screen.getByTestId('source-badge')).toHaveTextContent('marketplace')
    expect(screen.getByTestId('plugin-auth')).toHaveTextContent('tool-plugin/provider-a')
    expect(screen.getByTestId('operation-dropdown')).toHaveTextContent('https://marketplace.example.com/plugins/acme/provider-a')
    expect(screen.getByTestId('header-modals')).toBeInTheDocument()
  })

  it('wires version selection, latest update, and hide actions', () => {
    const onHide = vi.fn()
    render(<DetailHeader detail={createDetail()} onHide={onHide} onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByTestId('version-select'))
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.update'))
    fireEvent.click(screen.getByTestId('close-button'))

    expect(mockSetTargetVersion).toHaveBeenCalledWith({
      version: '2.0.0',
      unique_identifier: 'uid-2',
      isDowngrade: true,
    })
    expect(mockHandleUpdate).toHaveBeenCalledTimes(2)
    expect(mockHandleUpdate).toHaveBeenNthCalledWith(1, true)
    expect(onHide).toHaveBeenCalled()
  })
})
