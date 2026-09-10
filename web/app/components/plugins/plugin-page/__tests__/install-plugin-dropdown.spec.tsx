import type { ReactElement } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InstallPluginDropdown from '../install-plugin-dropdown'

const { mockSystemFeatures } = vi.hoisted(() => ({
  mockSystemFeatures: {
    enable_marketplace: true,
    plugin_installation_permission: {
      restrict_to_marketplace_only: false,
    },
  },
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS: '.difypkg,.zip',
  }
})

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: mockSystemFeatures })

vi.mock('@/app/components/base/icons/src/vender/solid/files', () => ({
  FileZip: () => <span data-testid="file-zip-icon">file</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/general', () => ({
  Github: () => <span data-testid="github-icon">github</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/mediaAndDevices', () => ({
  MagicBox: () => <span data-testid="magic-box-icon">magic</span>,
}))

vi.mock('@remixicon/react', () => ({
  RiAddCircleFill: ({ className }: { className?: string }) => (
    <span data-testid="add-circle-fill-icon" className={className} />
  ),
  RiArrowDownSLine: ({ className }: { className?: string }) => (
    <span data-testid="arrow-down-icon" className={className} />
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-github', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="github-modal">
      <button data-testid="close-github-modal" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({ file, onClose }: { file: File; onClose: () => void }) => (
    <div data-testid="local-modal">
      <span>{file.name}</span>
      <button data-testid="close-local-modal" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))

const getTrigger = (name = 'plugin.installPlugin') => screen.getByRole('button', { name })

describe('InstallPluginDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSystemFeatures.enable_marketplace = true
    mockSystemFeatures.plugin_installation_permission.restrict_to_marketplace_only = false
  })

  it('shows all install methods when marketplace and custom installs are enabled', () => {
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(getTrigger())

    expect(screen.getByText('plugin.installFrom')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.github')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.local')).toBeInTheDocument()
  })

  it('applies custom trigger label and presentation props', () => {
    const { container } = render(
      <InstallPluginDropdown
        onSwitchToMarketplaceTab={vi.fn()}
        rootClassName="custom-root"
        triggerClassName="custom-trigger"
        triggerLabel="Install"
        triggerOpenClassName="custom-open"
        triggerVariant="primary"
        popupClassName="custom-popup"
      />,
    )

    const trigger = getTrigger('Install')

    expect(container.querySelector('.custom-root')).toBeInTheDocument()
    expect(trigger).toHaveTextContent('Install')
    expect(screen.getByTestId('add-circle-fill-icon')).toBeInTheDocument()
    expect(screen.getByTestId('arrow-down-icon')).toBeInTheDocument()
    expect(trigger).toHaveClass('custom-trigger')
    expect(trigger).not.toHaveAttribute('data-popup-open')

    fireEvent.click(trigger)

    expect(trigger).toHaveClass('custom-open')
    expect(trigger).toHaveAttribute('data-popup-open', '')
    expect(screen.getByRole('menu')).toHaveClass('custom-popup')
  })

  it('can hide the trigger arrow for compact integrations placement', () => {
    render(
      <InstallPluginDropdown
        onSwitchToMarketplaceTab={vi.fn()}
        triggerLabel="Install"
        showTriggerArrow={false}
      />,
    )

    const trigger = getTrigger('Install')

    expect(trigger).toHaveTextContent('Install')
    expect(screen.getByTestId('add-circle-fill-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('arrow-down-icon')).not.toBeInTheDocument()
  })

  it('keeps the trigger visible but disabled when install is unavailable', () => {
    const onSwitchToMarketplaceTab = vi.fn()
    const { container } = render(
      <InstallPluginDropdown disabled onSwitchToMarketplaceTab={onSwitchToMarketplaceTab} />,
    )

    const trigger = getTrigger()

    expect(trigger).toBeDisabled()

    fireEvent.click(trigger)
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['content'], 'plugin.difypkg')],
      },
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('local-modal')).not.toBeInTheDocument()
    expect(onSwitchToMarketplaceTab).not.toHaveBeenCalled()
  })

  it('shows only marketplace when installation is restricted', () => {
    mockSystemFeatures.plugin_installation_permission.restrict_to_marketplace_only = true

    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(getTrigger())

    expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
    expect(screen.queryByText('plugin.source.github')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.source.local')).not.toBeInTheDocument()
  })

  it('switches to marketplace when the marketplace action is selected', () => {
    const onSwitchToMarketplaceTab = vi.fn()
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={onSwitchToMarketplaceTab} />)

    fireEvent.click(getTrigger())
    fireEvent.click(screen.getByText('plugin.source.marketplace'))

    expect(onSwitchToMarketplaceTab).toHaveBeenCalledTimes(1)
  })

  it('opens the github installer when github is selected', async () => {
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(getTrigger())
    fireEvent.click(screen.getByText('plugin.source.github'))

    expect(await screen.findByTestId('github-modal')).toBeInTheDocument()
  })

  it('opens the local package installer when a file is selected', () => {
    const { container } = render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(getTrigger())
    fireEvent.click(screen.getByText('plugin.source.local'))
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['content'], 'plugin.difypkg')],
      },
    })

    expect(screen.getByTestId('local-modal')).toBeInTheDocument()
    expect(screen.getByText('plugin.difypkg')).toBeInTheDocument()
  })

  it('triggers the hidden file input when local is selected from the menu', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(getTrigger())
    fireEvent.click(screen.getByText('plugin.source.local'))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('closes the github installer when the modal requests close', async () => {
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(getTrigger())
    fireEvent.click(screen.getByText('plugin.source.github'))
    fireEvent.click(await screen.findByTestId('close-github-modal'))

    expect(screen.queryByTestId('github-modal')).not.toBeInTheDocument()
  })

  it('closes the local package installer when the modal requests close', () => {
    const { container } = render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(getTrigger())
    fireEvent.click(screen.getByText('plugin.source.local'))
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['content'], 'plugin.difypkg')],
      },
    })
    fireEvent.click(screen.getByTestId('close-local-modal'))

    expect(screen.queryByTestId('local-modal')).not.toBeInTheDocument()
  })
})
