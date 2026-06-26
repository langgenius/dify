import type { ReactNode } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import DataSourcePluginActions from '../plugin-actions'

const {
  mockHandleDelete,
  mockHandleUpdate,
  mockHandleUpdatedFromMarketplace,
  mockOpenReadmePanel,
} = vi.hoisted(() => ({
  mockHandleDelete: vi.fn(),
  mockHandleUpdate: vi.fn(),
  mockHandleUpdatedFromMarketplace: vi.fn(),
  mockOpenReadmePanel: vi.fn(),
}))

vi.mock('@/app/components/plugins/readme-panel/store', () => ({
  useReadmePanelStore: (selector: (value: { openReadmePanel: typeof mockOpenReadmePanel }) => unknown) => selector({
    openReadmePanel: mockOpenReadmePanel,
  }),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/operation-dropdown', () => ({
  __esModule: true,
  default: ({ onViewReadme }: { onViewReadme?: () => void }) => (
    <button type="button" onClick={onViewReadme}>
      plugin.detailPanel.operation.viewReadme
    </button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/detail-header/hooks', () => ({
  useDetailHeaderState: () => ({
    modalStates: {
      showPluginInfo: vi.fn(),
      showDeleteConfirm: vi.fn(),
    },
    versionPicker: {
      isShow: false,
      setIsShow: vi.fn(),
      setTargetVersion: vi.fn(),
      targetVersion: undefined,
      isDowngrade: false,
    },
    hasNewVersion: false,
    isAutoUpgradeEnabled: false,
    isFromGitHub: false,
    isFromMarketplace: true,
  }),
  usePluginOperations: () => ({
    handleUpdate: mockHandleUpdate,
    handleUpdatedFromMarketplace: mockHandleUpdatedFromMarketplace,
    handleDelete: mockHandleDelete,
  }),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/detail-header/components', () => ({
  HeaderModals: () => <div data-testid="header-modals" />,
}))

vi.mock('@/app/components/base/badge', () => ({
  __esModule: true,
  default: ({ text }: { text: ReactNode }) => <div data-testid="badge">{text}</div>,
}))

vi.mock('@/app/components/plugins/update-plugin/plugin-version-picker', () => ({
  __esModule: true,
  default: ({ trigger }: { trigger: ReactNode }) => <div>{trigger}</div>,
}))

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.example.com${path}`,
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  usePluginSettingsAccess: () => ({
    canDeletePlugin: true,
    canUpdatePlugin: true,
  }),
}))

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-installation-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Data Source Plugin',
  plugin_id: 'datasource-plugin',
  plugin_unique_identifier: 'datasource-plugin:1.0.0@checksum',
  declaration: ({
    author: 'acme',
    category: PluginCategoryEnum.datasource,
    name: 'datasource-provider',
    label: { en_US: 'Data Source Plugin' },
    description: { en_US: 'Data Source description' },
    icon: 'icon.png',
    tags: [],
    datasource: {
      identity: {
        author: 'acme',
        name: 'datasource-provider',
        label: { en_US: 'Data Source Plugin' },
        description: { en_US: 'Data Source description' },
        icon: 'icon.png',
        tags: [],
      },
      credentials_schema: [],
    },
  } as unknown) as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'datasource-plugin:1.0.0@checksum',
  source: PluginSource.marketplace,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

describe('DataSourcePluginActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the plugin README from the actions menu', () => {
    const detail = createPluginDetail()

    render(<DataSourcePluginActions detail={detail} />)
    fireEvent.click(screen.getByText('plugin.detailPanel.operation.viewReadme'))

    expect(mockOpenReadmePanel).toHaveBeenCalledWith(expect.objectContaining({
      detail,
      triggerId: expect.any(String),
    }))
  })
})
