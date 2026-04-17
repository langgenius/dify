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
  Button: ({ children, onClick, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" data-testid="button-content" className={className} onClick={onClick} {...props}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/ui/dropdown-menu', async () => {
  const React = await import('react')
  const DropdownMenuContext = React.createContext<{ isOpen: boolean, setOpen: (open: boolean) => void } | null>(null)

  const useDropdownMenuContext = () => {
    const context = React.use(DropdownMenuContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange?: (open: boolean) => void
      children: React.ReactNode
    }) => {
      portalOpen = open
      return (
        <DropdownMenuContext value={{ isOpen: open, setOpen: onOpenChange ?? vi.fn() }}>
          <div data-testid="dropdown-menu" data-open={open}>{children}</div>
        </DropdownMenuContext>
      )
    },
    DropdownMenuTrigger: ({
      children,
      onClick,
      render,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler<HTMLElement>
      render?: React.ReactElement
    }) => {
      const { isOpen, setOpen } = useDropdownMenuContext()
      const handleClick = (e: React.MouseEvent<HTMLElement>) => {
        onClick?.(e)
        setOpen(!isOpen)
      }

      if (render)
        return React.cloneElement(render, { 'data-testid': 'dropdown-trigger', 'onClick': handleClick } as Record<string, unknown>, children)

      return <button data-testid="dropdown-trigger" onClick={handleClick}>{children}</button>
    },
    DropdownMenuContent: ({
      children,
    }: {
      children: React.ReactNode
    }) => portalOpen ? <div data-testid="dropdown-content">{children}</div> : null,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler<HTMLButtonElement>
    }) => {
      const { setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          data-testid="dropdown-item"
          onClick={(e) => {
            onClick?.(e)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
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

  it('opens the github installer when github is selected', async () => {
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))
    fireEvent.click(screen.getByText('plugin.source.github'))

    expect(await screen.findByTestId('github-modal')).toBeInTheDocument()
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

  it('triggers the hidden file input when local is selected from the menu', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))
    fireEvent.click(screen.getByText('plugin.source.local'))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('closes the github installer when the modal requests close', async () => {
    render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))
    fireEvent.click(screen.getByText('plugin.source.github'))
    fireEvent.click(await screen.findByTestId('close-github-modal'))

    expect(screen.queryByTestId('github-modal')).not.toBeInTheDocument()
  })

  it('closes the local package installer when the modal requests close', () => {
    const { container } = render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['content'], 'plugin.difypkg')],
      },
    })
    fireEvent.click(screen.getByTestId('close-local-modal'))

    expect(screen.queryByTestId('local-modal')).not.toBeInTheDocument()
  })
})
