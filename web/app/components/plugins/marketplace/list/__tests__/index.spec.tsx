import type { Plugin } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import List from '../index'

vi.mock(
  '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider',
  () => ({
    PluginInstallPermissionProviderGuard: ({ children }: { children: React.ReactNode }) => children,
  }),
)

vi.mock('@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission', () => ({
  useOptionalPluginInstallPermission: () => ({ canInstallPlugin: true }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: { installed: {} } }),
}))

vi.mock('../list-with-collection', () => ({
  default: () => <div>Collections</div>,
}))

vi.mock('../card-wrapper', () => ({
  default: ({ plugin, isInstalled }: { plugin: Plugin; isInstalled: boolean }) => (
    <div>
      {plugin.name}:{isInstalled ? 'installed' : 'available'}
    </div>
  ),
}))

vi.mock('../../empty', () => ({
  default: () => <div>No plugins</div>,
}))

const baseProps = {
  marketplaceCollections: [],
  marketplaceCollectionPluginsMap: {},
}

describe('List', () => {
  it('renders collections when search results are absent', () => {
    render(<List {...baseProps} />)

    expect(screen.getByText('Collections')).toBeInTheDocument()
  })

  it('renders the empty state for an empty search result', () => {
    render(<List {...baseProps} plugins={[]} />)

    expect(screen.getByText('No plugins')).toBeInTheDocument()
  })

  it('renders search results with installed state', () => {
    const plugins = [
      { plugin_id: 'installed', name: 'Installed plugin', org: 'dify' },
      { plugin_id: 'available', name: 'Available plugin', org: 'dify' },
    ] as Plugin[]

    render(<List {...baseProps} plugins={plugins} showInstallButton />)

    expect(screen.getByText('Installed plugin:installed')).toBeInTheDocument()
    expect(screen.getByText('Available plugin:available')).toBeInTheDocument()
  })
})
