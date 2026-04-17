import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PluginPage from '@/app/components/plugins/plugin-page'
import { renderWithNuqs } from '@/test/nuqs-testing'

const mockFetchManifestFromMarketPlace = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils')>()
  return {
    ...actual,
    sleep: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('@/hooks/use-document-title', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: false,
    isCurrentWorkspaceOwner: false,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    systemFeatures: {
      enable_marketplace: true,
      plugin_installation_permission: {
        restrict_to_marketplace_only: false,
      },
    },
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useReferenceSettings: () => ({
    data: {
      permission: {
        install_permission: 'everyone',
        debug_permission: 'noOne',
      },
    },
  }),
  useMutationReferenceSettings: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useInvalidateReferenceSettings: () => vi.fn(),
  useInstalledPluginList: () => ({
    data: {
      total: 2,
    },
  }),
}))

vi.mock('@/service/plugins', () => ({
  fetchManifestFromMarketPlace: (...args: unknown[]) => mockFetchManifestFromMarketPlace(...args),
  fetchBundleInfoFromMarketPlace: vi.fn(),
}))

vi.mock('@/app/components/plugins/plugin-page/plugin-tasks', () => ({
  default: () => <div data-testid="plugin-tasks">plugin tasks</div>,
}))

vi.mock('@/app/components/plugins/plugin-page/debug-info', () => ({
  default: () => <div data-testid="debug-info">debug info</div>,
}))

vi.mock('@/app/components/plugins/plugin-page/install-plugin-dropdown', () => ({
  default: ({ onSwitchToMarketplaceTab }: { onSwitchToMarketplaceTab: () => void }) => (
    <button type="button" data-testid="install-plugin-dropdown" onClick={onSwitchToMarketplaceTab}>
      install plugin
    </button>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({
    uniqueIdentifier,
    onClose,
  }: {
    uniqueIdentifier: string
    onClose: () => void
  }) => (
    <div data-testid="install-from-marketplace-modal">
      <span>{uniqueIdentifier}</span>
      <button type="button" onClick={onClose}>close-install-modal</button>
    </div>
  ),
}))

const renderPluginPage = (searchParams = '') => {
  return renderWithNuqs(
    <PluginPage
      plugins={<div data-testid="plugins-view">plugins view</div>}
      marketplace={<div data-testid="marketplace-view">marketplace view</div>}
    />,
    { searchParams },
  )
}

describe('Plugin Page Shell Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchManifestFromMarketPlace.mockResolvedValue({
      data: {
        plugin: {
          org: 'langgenius',
          name: 'plugin-demo',
        },
        version: {
          version: '1.0.0',
        },
      },
    })
  })

  it('switches from installed plugins to marketplace and syncs the active tab into the URL', async () => {
    const { onUrlUpdate } = renderPluginPage()

    expect(screen.getByTestId('plugins-view'))!.toBeInTheDocument()
    expect(screen.queryByTestId('marketplace-view')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tab-item-discover'))

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-view'))!.toBeInTheDocument()
    })

    const tabUpdate = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
    expect(tabUpdate.searchParams.get('tab')).toBe('discover')
  })

  it('hydrates marketplace installation from query params and clears the install state when closed', async () => {
    const { onUrlUpdate } = renderPluginPage('?package-ids=%5B%22langgenius%2Fplugin-demo%22%5D')

    await waitFor(() => {
      expect(mockFetchManifestFromMarketPlace).toHaveBeenCalledWith('langgenius%2Fplugin-demo')
      expect(screen.getByTestId('install-from-marketplace-modal'))!.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'close-install-modal' }))

    await waitFor(() => {
      const clearUpdate = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(clearUpdate.searchParams.has('package-ids')).toBe(false)
    })
  })
})
