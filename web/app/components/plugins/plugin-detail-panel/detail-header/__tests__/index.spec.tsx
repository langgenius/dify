/* eslint-disable ts/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '@/app/components/plugins/types'
import DetailHeader from '../index'

const mockUseDetailHeaderState = vi.fn()
const mockUsePluginOperations = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => values?.time ? `${key}:${values.time}` : key,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      timezone: 'Asia/Shanghai',
    },
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
  useLocale: () => 'en-US',
}))

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({
    data: [{ name: 'plugin-1/search', type: 'builtin' }],
  }),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: Array<string | undefined | false | null>) => args.filter(Boolean).join(' '),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.example.com${path}`,
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  default: () => ({
    referenceSetting: {
      auto_upgrade: {
        upgrade_time_of_day: 36000,
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

vi.mock('@/app/components/plugins/plugin-detail-panel/detail-header/hooks', () => ({
  useDetailHeaderState: () => mockUseDetailHeaderState(),
  usePluginOperations: (...args: unknown[]) => mockUsePluginOperations(...args),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
}))

vi.mock('@/app/components/base/badge', () => ({
  default: ({ text, hasRedCornerMark, className }: { text: React.ReactNode, hasRedCornerMark?: boolean, className?: string }) => (
    <div data-testid="badge" data-red={String(!!hasRedCornerMark)} data-class={className}>{text}</div>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AuthCategory: { tool: 'tool' },
  PluginAuth: ({ pluginPayload }: { pluginPayload: { provider: string, providerType: string } }) => (
    <div data-testid="plugin-auth">{`${pluginPayload.provider}|${pluginPayload.providerType}`}</div>
  ),
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="card-icon">{src}</div>,
}))

vi.mock('@/app/components/plugins/card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

vi.mock('@/app/components/plugins/card/base/org-info', () => ({
  default: ({ orgName, packageName }: { orgName: string, packageName: string }) => <div data-testid="org-info">{`${orgName}/${packageName}`}</div>,
}))

vi.mock('@/app/components/plugins/card/base/title', () => ({
  default: ({ title }: { title: string }) => <div data-testid="title">{title}</div>,
}))

vi.mock('@/app/components/plugins/base/badges/verified', () => ({
  default: () => <div data-testid="verified-badge" />,
}))

vi.mock('@/app/components/plugins/base/deprecation-notice', () => ({
  default: () => <div data-testid="deprecation-notice" />,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/operation-dropdown', () => ({
  default: ({ detailUrl, onCheckVersion }: { detailUrl: string, onCheckVersion: () => void }) => (
    <div data-testid="operation-dropdown">
      <div>{detailUrl}</div>
      <button type="button" onClick={onCheckVersion}>check-version</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/update-plugin/plugin-version-picker', () => ({
  default: ({ trigger, disabled }: { trigger: React.ReactNode, disabled?: boolean }) => <div data-testid="version-picker" data-disabled={String(!!disabled)}>{trigger}</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/detail-header/components', () => ({
  HeaderModals: () => <div data-testid="header-modals" />,
  PluginSourceBadge: ({ source }: { source: string }) => <div data-testid="plugin-source-badge">{source}</div>,
}))

vi.mock('../../../base/icons/src/vender/system', () => ({
  AutoUpdateLine: () => <div data-testid="auto-update-line" />,
}))

const createDetail = (overrides: Record<string, unknown> = {}) => ({
  id: 'detail-1',
  source: PluginSource.marketplace,
  tenant_id: 'tenant-1',
  version: '1.0.0',
  latest_version: '1.1.0',
  latest_unique_identifier: 'plugin-1@1.1.0',
  plugin_id: 'plugin-1',
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: 'plugin-2',
  meta: {
    repo: 'langgenius/dify-plugin',
  },
  declaration: {
    author: 'langgenius',
    category: 'tool',
    name: 'search',
    label: { en_US: 'Search Plugin' },
    description: { en_US: 'Search description' },
    icon: 'icon.png',
    icon_dark: 'icon-dark.png',
    verified: true,
    tool: {
      identity: {
        name: 'search',
      },
    },
  },
  ...overrides,
})

describe('DetailHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDetailHeaderState.mockReturnValue({
      modalStates: {
        showPluginInfo: vi.fn(),
        showDeleteConfirm: vi.fn(),
      },
      versionPicker: {
        isShow: false,
        setIsShow: vi.fn(),
        setTargetVersion: vi.fn(),
      },
      hasNewVersion: true,
      isAutoUpgradeEnabled: true,
      isFromGitHub: false,
      isFromMarketplace: true,
    })
    mockUsePluginOperations.mockReturnValue({
      handleUpdate: vi.fn(),
      handleUpdatedFromMarketplace: vi.fn(),
      handleDelete: vi.fn(),
    })
  })

  it('should build marketplace links, show update badge, auto-upgrade tooltip, and plugin auth', () => {
    render(<DetailHeader detail={createDetail() as any} />)

    expect(screen.getByTestId('operation-dropdown')).toHaveTextContent('https://marketplace.example.com/plugins/langgenius/search')
    expect(screen.getAllByTestId('badge')[0]).toHaveAttribute('data-red', 'true')
    expect(screen.getByText('detailPanel.operation.update')).toBeInTheDocument()
    expect(screen.getByText('autoUpdate.nextUpdateTime:10:00 AM')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-auth')).toHaveTextContent('plugin-1/search|builtin')
    expect(screen.getByTestId('description')).toHaveTextContent('Search description')
  })

  it('should switch to the github detail url and keep update actions visible for github sources', () => {
    mockUseDetailHeaderState.mockReturnValue({
      modalStates: {
        showPluginInfo: vi.fn(),
        showDeleteConfirm: vi.fn(),
      },
      versionPicker: {
        isShow: false,
        setIsShow: vi.fn(),
        setTargetVersion: vi.fn(),
      },
      hasNewVersion: false,
      isAutoUpgradeEnabled: false,
      isFromGitHub: true,
      isFromMarketplace: false,
    })

    render(<DetailHeader detail={createDetail({ source: PluginSource.github }) as any} />)

    expect(screen.getByTestId('operation-dropdown')).toHaveTextContent('https://github.com/langgenius/dify-plugin')
    expect(screen.getByText('detailPanel.operation.update')).toBeInTheDocument()
  })

  it('should collapse into readme mode without operation controls or auth panels', () => {
    render(<DetailHeader detail={createDetail() as any} isReadmeView />)

    expect(screen.queryByTestId('operation-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('verified-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('description')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plugin-auth')).not.toBeInTheDocument()
    expect(screen.getByTestId('version-picker')).toHaveAttribute('data-disabled', 'true')
  })
})
