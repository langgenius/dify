import type { PackageDependency } from '../../../../types'
import type { VersionProps } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../../../types'
import PackageItem from '../package-item'

const mockPluginManifestToCardPluginProps = vi.fn()
const mockLoadedItem = vi.fn()

vi.mock('../../../utils', () => ({
  pluginManifestToCardPluginProps: (manifest: unknown) => mockPluginManifestToCardPluginProps(manifest),
}))

vi.mock('../../../base/loading-error', () => ({
  default: () => <div data-testid="loading-error">loading-error</div>,
}))

vi.mock('../loaded-item', () => ({
  default: (props: Record<string, unknown>) => {
    mockLoadedItem(props)
    return <div data-testid="loaded-item">loaded-item</div>
  },
}))

const versionInfo: VersionProps = {
  hasInstalled: false,
  installedVersion: '',
  toInstallVersion: '1.0.0',
}

const payload = {
  type: 'package',
  value: {
    manifest: {
      plugin_unique_identifier: 'plugin-1',
      version: '1.0.0',
      author: 'dify',
      icon: 'icon.png',
      name: 'Package Plugin',
      category: PluginCategoryEnum.tool,
      label: { en_US: 'Package Plugin', zh_Hans: 'Package Plugin' },
      description: { en_US: 'Description', zh_Hans: 'Description' },
      created_at: '2024-01-01',
      resource: {},
      plugins: [],
      verified: true,
      endpoint: { settings: [], endpoints: [] },
      model: null,
      tags: [],
      agent_strategy: null,
      meta: { version: '1.0.0' },
      trigger: {
        events: [],
        identity: {
          author: 'dify',
          name: 'trigger',
          description: { en_US: 'Trigger', zh_Hans: 'Trigger' },
          icon: 'icon.png',
          label: { en_US: 'Trigger', zh_Hans: 'Trigger' },
          tags: [],
        },
        subscription_constructor: {
          credentials_schema: [],
          oauth_schema: {
            client_schema: [],
            credentials_schema: [],
          },
          parameters: [],
        },
        subscription_schema: [],
      },
    },
  },
} as unknown as PackageDependency

describe('PackageItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading error when manifest is missing', () => {
    render(
      <PackageItem
        checked={false}
        onCheckedChange={vi.fn()}
        payload={{ type: 'package', value: {} } as unknown as PackageDependency}
        versionInfo={versionInfo}
      />,
    )

    expect(screen.getByTestId('loading-error')).toBeInTheDocument()
  })

  it('renders LoadedItem with converted plugin payload', () => {
    mockPluginManifestToCardPluginProps.mockReturnValue({
      plugin_id: 'plugin-1',
      name: 'Package Plugin',
      org: 'dify',
      icon: 'icon.png',
    })

    render(
      <PackageItem
        checked
        onCheckedChange={vi.fn()}
        payload={payload}
        versionInfo={versionInfo}
        isFromMarketPlace
      />,
    )

    expect(screen.getByTestId('loaded-item')).toBeInTheDocument()
    expect(mockLoadedItem).toHaveBeenCalledWith(expect.objectContaining({
      checked: true,
      isFromMarketPlace: true,
      versionInfo,
      payload: expect.objectContaining({
        plugin_id: 'plugin-1',
        from: 'package',
      }),
    }))
  })
})
