import type { GitHubItemAndMarketPlaceDependency, Plugin, VersionProps } from '@/app/components/plugins/types'
import { render, screen, waitFor } from '@testing-library/react'
import { useUploadGitHub } from '@/service/use-plugins'
import GitHubItem from '../github-item'

const mockUseUploadGitHub = vi.mocked(useUploadGitHub)
const mockPluginManifestToCardPluginProps = vi.fn()

vi.mock('@/service/use-plugins', () => ({
  useUploadGitHub: vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('@/app/components/plugins/install-plugin/utils', () => ({
  pluginManifestToCardPluginProps: (...args: unknown[]) => mockPluginManifestToCardPluginProps(...args),
}))

vi.mock('../loaded-item', () => ({
  default: ({ payload, checked }: { payload: Plugin, checked: boolean }) => (
    <div data-testid="loaded-item" data-plugin-id={payload.plugin_id} data-from={payload.from} data-checked={String(checked)}>
      {payload.name}
    </div>
  ),
}))

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'tool',
  org: 'plugin-org',
  name: 'Plugin Name',
  plugin_id: 'plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'pkg-id',
  icon: 'icon.png',
  verified: false,
  label: { 'en-US': 'Plugin Name' } as Plugin['label'],
  brief: { 'en-US': 'Plugin brief' } as Plugin['brief'],
  description: { 'en-US': 'Plugin description' } as Plugin['description'],
  introduction: '',
  repository: '',
  category: 'tool' as Plugin['category'],
  install_count: 0,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'langgenius' },
  from: 'github',
  ...overrides,
})

const versionInfo: VersionProps = {
  hasInstalled: false,
  toInstallVersion: '0.0.1',
}

const dependency: GitHubItemAndMarketPlaceDependency = {
  type: 'github',
  value: {
    repo: 'org/repo',
    release: '1.2.3',
    packages: 'tool',
  },
}

describe('GitHubItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUploadGitHub.mockReturnValue({
      data: undefined,
      error: undefined,
    } as unknown as ReturnType<typeof useUploadGitHub>)
    mockPluginManifestToCardPluginProps.mockReturnValue(createPlugin())
  })

  // Covers request parameter normalization and loading state.
  describe('loading', () => {
    it('should request the github package using release and packages fallbacks', () => {
      render(
        <GitHubItem
          checked={false}
          onCheckedChange={vi.fn()}
          dependency={dependency}
          versionInfo={versionInfo}
          onFetchedPayload={vi.fn()}
          onFetchError={vi.fn()}
        />,
      )

      expect(mockUseUploadGitHub).toHaveBeenCalledWith({
        repo: 'org/repo',
        version: '1.2.3',
        package: 'tool',
      })
      expect(screen.getByText('loading')).toBeInTheDocument()
    })
  })

  // Covers success and failure side effects.
  describe('effects', () => {
    it('should transform the fetched manifest and render the loaded item', async () => {
      const onFetchedPayload = vi.fn()
      mockUseUploadGitHub.mockReturnValue({
        data: {
          manifest: { plugin_unique_identifier: 'manifest-plugin-id' },
          unique_identifier: 'github-uid',
        },
        error: undefined,
      } as unknown as ReturnType<typeof useUploadGitHub>)

      render(
        <GitHubItem
          checked
          onCheckedChange={vi.fn()}
          dependency={dependency}
          versionInfo={versionInfo}
          onFetchedPayload={onFetchedPayload}
          onFetchError={vi.fn()}
        />,
      )

      await waitFor(() => expect(onFetchedPayload).toHaveBeenCalledWith(expect.objectContaining({
        plugin_id: 'github-uid',
      })))
      expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-plugin-id', 'github-uid')
      expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-from', 'github')
      expect(screen.getByTestId('loaded-item')).toHaveAttribute('data-checked', 'true')
    })

    it('should notify the parent when the github upload hook returns an error', async () => {
      const onFetchError = vi.fn()
      mockUseUploadGitHub.mockReturnValue({
        data: undefined,
        error: new Error('failed'),
      } as unknown as ReturnType<typeof useUploadGitHub>)

      render(
        <GitHubItem
          checked={false}
          onCheckedChange={vi.fn()}
          dependency={dependency}
          versionInfo={versionInfo}
          onFetchedPayload={vi.fn()}
          onFetchError={onFetchError}
        />,
      )

      await waitFor(() => expect(onFetchError).toHaveBeenCalledTimes(1))
    })
  })
})
