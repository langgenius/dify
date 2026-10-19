import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactElement } from 'react'
import type { FilterState } from '../../filter-management'
import { zPluginInstallationScope } from '@dify/contracts/api/console/system-features/zod.gen'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import Empty from '../index'

const { mockSetActiveTab, mockUseInstalledPluginList, mockState } = vi.hoisted(() => {
  const state = {
    filters: {
      categories: [] as string[],
      tags: [] as string[],
      searchQuery: '',
    } as FilterState,
    systemFeatures: {
      enable_marketplace: true,
      plugin_installation_permission: {
        plugin_installation_scope: 'all' as const,
        restrict_to_marketplace_only: false,
      },
    } as Partial<GetSystemFeaturesResponse>,
    pluginList: { plugins: [] as Array<{ id: string }> } as
      | { plugins: Array<{ id: string }> }
      | undefined,
  }
  return {
    mockSetActiveTab: vi.fn(),
    mockUseInstalledPluginList: vi.fn(() => ({ data: state.pluginList })),
    mockState: state,
  }
})

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: mockState.systemFeatures })

vi.mock('../../context', () => ({
  usePluginPageContext: (selector: (value: Record<string, unknown>) => unknown) => {
    const contextValue = {
      filters: mockState.filters,
      setActiveTab: mockSetActiveTab,
    }
    return selector(contextValue)
  },
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => mockUseInstalledPluginList(),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-github', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-from-github-modal">
      <button data-testid="github-modal-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-local-package', () => ({
  default: ({ file, onClose }: { file: File; onClose: () => void }) => (
    <div data-testid="install-from-local-modal" data-file-name={file.name}>
      <button data-testid="local-modal-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}))

const resetMockState = () => {
  mockState.filters = { categories: [], tags: [], searchQuery: '' }
  mockState.systemFeatures = {
    enable_marketplace: true,
    plugin_installation_permission: {
      plugin_installation_scope: zPluginInstallationScope.enum.all,
      restrict_to_marketplace_only: false,
    },
  }
  mockState.pluginList = { plugins: [] }
  mockUseInstalledPluginList.mockReturnValue({ data: mockState.pluginList })
}

const setMockFilters = (filters: Partial<FilterState>) => {
  mockState.filters = { ...mockState.filters, ...filters }
}

const setMockSystemFeatures = (features: Partial<GetSystemFeaturesResponse>) => {
  mockState.systemFeatures = { ...mockState.systemFeatures, ...features }
}

const setMockPluginList = (list: { plugins: Array<{ id: string }> } | undefined) => {
  mockState.pluginList = list
  mockUseInstalledPluginList.mockReturnValue({ data: list })
}

const createMockFile = (name: string, type = 'application/octet-stream'): File => {
  return new File(['test'], name, { type })
}

const getFileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!

describe('Plugin list empty state', () => {
  beforeEach(() => {
    resetMockState()
  })

  it('shows the no-installed message even when filters are active', () => {
    setMockFilters({ categories: ['model'], searchQuery: 'test' })
    render(<Empty />)

    expect(screen.getByText('plugin.list.noInstalled')).toBeInTheDocument()
    expect(screen.queryByText('plugin.list.notFound')).not.toBeInTheDocument()
  })

  it.each([{ categories: ['model'] }, { tags: ['tag1'] }, { searchQuery: 'test query' }])(
    'shows no results for an installed list filtered by %o',
    (filters) => {
      setMockPluginList({ plugins: [{ id: 'plugin-1' }] })
      setMockFilters(filters)
      render(<Empty />)

      expect(screen.getByText('plugin.list.notFound')).toBeInTheDocument()
    },
  )

  it.each([
    { marketplace: true, restricted: false, methods: ['marketplace', 'github', 'local'] },
    { marketplace: true, restricted: true, methods: ['marketplace'] },
    { marketplace: false, restricted: false, methods: ['github', 'local'] },
    { marketplace: false, restricted: true, methods: [] },
  ])(
    'offers $methods with marketplace=$marketplace and restricted=$restricted',
    ({ marketplace, restricted, methods }) => {
      setMockSystemFeatures({
        enable_marketplace: marketplace,
        plugin_installation_permission: {
          plugin_installation_scope: zPluginInstallationScope.enum.all,
          restrict_to_marketplace_only: restricted,
        },
      })
      render(<Empty />)

      for (const method of ['marketplace', 'github', 'local']) {
        const button = screen.queryByRole('button', { name: `plugin.source.${method}` })
        if (methods.includes(method)) expect(button).toBeInTheDocument()
        else expect(button).not.toBeInTheDocument()
      }
    },
  )

  it('hides installation actions and ignores file changes without install permission', () => {
    render(<Empty canInstall={false} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)

    // Exercise the permission guard even if a file change reaches the hidden input.
    fireEvent.change(getFileInput(), { target: { files: [createMockFile('blocked.difypkg')] } })
    expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()
  })

  it('opens the discovery tab from the marketplace action', async () => {
    const user = userEvent.setup()
    render(<Empty />)

    await user.click(screen.getByRole('button', { name: 'plugin.source.marketplace' }))

    expect(mockSetActiveTab).toHaveBeenCalledWith('discover')
  })

  it('uses the supplied marketplace navigation instead of switching tabs', async () => {
    const user = userEvent.setup()
    const onSwitchToMarketplace = vi.fn()
    render(<Empty onSwitchToMarketplace={onSwitchToMarketplace} />)

    await user.click(screen.getByRole('button', { name: 'plugin.source.marketplace' }))

    expect(onSwitchToMarketplace).toHaveBeenCalledTimes(1)
    expect(mockSetActiveTab).not.toHaveBeenCalled()
  })

  it('opens, closes, and reopens the GitHub installer', async () => {
    const user = userEvent.setup()
    render(<Empty />)
    expect(screen.queryByTestId('install-from-github-modal')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'plugin.source.github' }))
    expect(screen.getByTestId('install-from-github-modal')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('install-from-github-modal')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'plugin.source.github' }))
    expect(screen.getByTestId('install-from-github-modal')).toBeInTheDocument()
  })

  it('opens the file picker for supported plugin and bundle files', async () => {
    const user = userEvent.setup()
    render(<Empty />)
    const input = getFileInput()
    const clickSpy = vi.spyOn(input, 'click')

    await user.click(screen.getByRole('button', { name: 'plugin.source.local' }))

    expect(clickSpy).toHaveBeenCalledOnce()
    expect(input).toHaveAttribute('accept', '.difypkg,.difybndl')
    expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()
    clickSpy.mockRestore()
  })

  it('passes the selected package to the installer and accepts a new bundle after closing', async () => {
    const user = userEvent.setup()
    render(<Empty />)
    const input = getFileInput()

    await user.upload(input, createMockFile('my-plugin.difypkg'))
    expect(screen.getByTestId('install-from-local-modal')).toHaveAttribute(
      'data-file-name',
      'my-plugin.difypkg',
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()

    await user.upload(input, createMockFile('my-bundle.difybndl'))
    expect(screen.getByTestId('install-from-local-modal')).toHaveAttribute(
      'data-file-name',
      'my-bundle.difybndl',
    )
  })

  it('does not open an installer when file selection is cancelled', () => {
    render(<Empty />)

    fireEvent.change(getFileInput(), { target: { files: [] } })

    expect(screen.queryByTestId('install-from-local-modal')).not.toBeInTheDocument()
  })
})
