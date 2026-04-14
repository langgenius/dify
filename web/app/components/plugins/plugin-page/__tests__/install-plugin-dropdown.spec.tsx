import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InstallPluginDropdown from '../install-plugin-dropdown'

let portalOpen = false
const {
  mockSystemFeatures,
} = vi.hoisted(() => ({
  mockSystemFeatures: {
    enable_marketplace: true,
    plugin_installation_permission: {
      restrict_to_marketplace_only: false,
    },
  },
}))

vi.mock('@/config', () => ({
  SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS: '.difypkg,.zip',
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: typeof mockSystemFeatures }) => unknown) =>
    selector({ systemFeatures: mockSystemFeatures }),
}))

vi.mock('@/app/components/base/icons/src/vender/solid/files', () => ({
  FileZip: () => <span data-testid="file-zip-icon">file</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/general', () => ({
  Github: () => <span data-testid="github-icon">github</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/mediaAndDevices', () => ({
  MagicBox: () => <span data-testid="magic-box-icon">magic</span>,
}))

vi.mock('@/app/components/base/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <span data-testid="button-content">{children}</span>,
}))

vi.mock('@/app/components/base/portal-to-follow-elem', async () => {
  const React = await import('react')
  return {
    PortalToFollowElem: ({
      open,
      children,
    }: {
      open: boolean
      children: React.ReactNode
    }) => {
      portalOpen = open
      return <div>{children}</div>
    },
    PortalToFollowElemTrigger: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick: () => void
    }) => <button data-testid="dropdown-trigger" onClick={onClick}>{children}</button>,
    PortalToFollowElemContent: ({
      children,
    }: {
      children: React.ReactNode
    }) => portalOpen ? <div data-testid="dropdown-content">{children}</div> : null,
  }
})

vi.mock('@/app/components/plugins/install-plugin/install-from-github', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="github-modal">
      <button data-testid="close-github-modal" onClick={onClose}>close</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({
    file,
    onClose,
  }: {
    file: File
    onClose: () => void
  }) => (
    <div data-testid="local-modal">
      <span>{file.name}</span>
      <button data-testid="close-local-modal" onClick={onClose}>close</button>
    </div>
  ),
}))

describe('InstallPluginDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpen = false
    mockSystemFeatures.enable_marketplace = true
    mockSystemFeatures.plugin_installation_permission.restrict_to_marketplace_only = false
  })

  it('shows all install methods when marketplace and custom installs are enabled', () => {
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))

    expect(screen.getByText('plugin.installFrom')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.github')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.local')).toBeInTheDocument()
  })

  it('shows only marketplace when installation is restricted', () => {
    mockSystemFeatures.plugin_installation_permission.restrict_to_marketplace_only = true

    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))

    expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
    expect(screen.queryByText('plugin.source.github')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.source.local')).not.toBeInTheDocument()
  })

  it('switches to marketplace when the marketplace action is selected', () => {
    const onSwitchToMarketplaceTab = vi.fn()
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={onSwitchToMarketplaceTab} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))
    fireEvent.click(screen.getByText('plugin.source.marketplace'))

    expect(onSwitchToMarketplaceTab).toHaveBeenCalledTimes(1)
  })

  it('opens the github installer when github is selected', () => {
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))
    fireEvent.click(screen.getByText('plugin.source.github'))

    expect(screen.getByTestId('github-modal')).toBeInTheDocument()
  })

  it('opens the local package installer when a file is selected', () => {
    const { container } = render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['content'], 'plugin.difypkg')],
      },
    })

    expect(screen.getByTestId('local-modal')).toBeInTheDocument()
    expect(screen.getByText('plugin.difypkg')).toBeInTheDocument()
  })
})
