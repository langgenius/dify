import type { ReactElement } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import InstallPluginDropdown from '../install-plugin-dropdown'

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

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS: '.difypkg,.zip',
  }
})

const render = (ui: ReactElement) =>
  renderWithSystemFeatures(ui, { systemFeatures: mockSystemFeatures })

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
  RiAddCircleFill: ({ className }: { className?: string }) => <span data-testid="add-circle-fill-icon" className={className} />,
  RiArrowDownSLine: ({ className }: { className?: string }) => <span data-testid="arrow-down-icon" className={className} />,
}))

type MockButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string
}

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children, onClick, className, variant, ...props }: MockButtonProps) => (
    <button type="button" data-testid="button-content" data-variant={variant} className={className} onClick={onClick} {...props}>{children}</button>
  ),
}))

vi.mock('@langgenius/dify-ui/dropdown-menu', async () => {
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
      modal,
      children,
    }: {
      open?: boolean
      onOpenChange?: (open: boolean) => void
      modal?: boolean
      children: React.ReactNode
    }) => {
      const [internalOpen, setInternalOpen] = React.useState(open ?? false)
      const isOpen = open ?? internalOpen
      const setOpen = (nextOpen: boolean) => {
        if (open === undefined)
          setInternalOpen(nextOpen)
        onOpenChange?.(nextOpen)
      }

      return (
        <DropdownMenuContext value={{ isOpen, setOpen }}>
          <div data-testid="dropdown-menu" data-open={isOpen} data-modal={modal}>{children}</div>
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
      popupClassName,
    }: {
      children: React.ReactNode
      popupClassName?: string
    }) => {
      const { isOpen } = useDropdownMenuContext()
      return isOpen ? <div data-testid="dropdown-content" className={popupClassName}>{children}</div> : null
    },
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
    mockSystemFeatures.enable_marketplace = true
    mockSystemFeatures.plugin_installation_permission.restrict_to_marketplace_only = false
  })

  it('shows all install methods when marketplace and custom installs are enabled', () => {
    const { container } = render(<InstallPluginDropdown onSwitchToMarketplaceTab={vi.fn()} />)

    fireEvent.click(screen.getByTestId('dropdown-trigger'))

    expect(screen.getByTestId('dropdown-menu')).toHaveAttribute('data-modal', 'false')
    expect(screen.getByText('plugin.installFrom')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.marketplace')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.github')).toBeInTheDocument()
    expect(screen.getByText('plugin.source.local')).toBeInTheDocument()
    expect(container.querySelector('.i-custom-vender-plugin-box-sparkle-fill')).toHaveClass('size-4', 'shrink-0')
    expect(container.querySelector('.i-custom-vender-solid-general-github')).toHaveClass('size-4', 'shrink-0')
    expect(container.querySelector('.i-custom-vender-solid-files-file-zip')).toHaveClass('size-4', 'shrink-0')
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

    const trigger = screen.getByTestId('dropdown-trigger')

    expect(container.querySelector('.custom-root')).toBeInTheDocument()
    expect(trigger).toHaveTextContent('Install')
    expect(screen.getByTestId('add-circle-fill-icon')).toHaveClass('size-4', 'shrink-0')
    expect(screen.getByTestId('arrow-down-icon')).toHaveClass('ml-1', 'size-4')
    expect(trigger).toHaveClass('custom-trigger')
    expect(trigger).toHaveAttribute('data-variant', 'primary')

    fireEvent.click(trigger)

    expect(trigger).toHaveClass('custom-open')
    expect(screen.getByTestId('dropdown-content')).toHaveClass('custom-popup')
  })

  it('can hide the trigger arrow for compact integrations placement', () => {
    const { container } = render(
      <InstallPluginDropdown
        onSwitchToMarketplaceTab={vi.fn()}
        triggerLabel="Install"
        showTriggerArrow={false}
      />,
    )

    const trigger = screen.getByTestId('dropdown-trigger')

    expect(trigger).toHaveTextContent('Install')
    expect(screen.getByTestId('add-circle-fill-icon')).toHaveClass('size-4', 'shrink-0')
    expect(screen.queryByTestId('arrow-down-icon')).not.toBeInTheDocument()
    expect(container.querySelector('.px-0\\.5')).toHaveClass('min-w-0', 'flex-1', 'text-left')
  })

  it('keeps the trigger visible but disabled when install is unavailable', () => {
    const onSwitchToMarketplaceTab = vi.fn()
    const { container } = render(<InstallPluginDropdown disabled onSwitchToMarketplaceTab={onSwitchToMarketplaceTab} />)

    const trigger = screen.getByTestId('dropdown-trigger')

    expect(trigger).toBeDisabled()

    fireEvent.click(trigger)
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['content'], 'plugin.difypkg')],
      },
    })

    expect(screen.queryByTestId('dropdown-content')).not.toBeInTheDocument()
    expect(screen.queryByTestId('local-modal')).not.toBeInTheDocument()
    expect(onSwitchToMarketplaceTab).not.toHaveBeenCalled()
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
