import type { GitHubItemAndMarketPlaceDependency } from '../../../../types'
import type { VersionProps } from '@/app/components/plugins/types'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createPluginEntity } from '@/test/fixtures/plugin'
import GithubItem from '../github-item'

const mockUseUploadGitHub = vi.fn()
const mockLoadedItem = vi.fn()

vi.mock('@/service/use-plugins', () => ({
  useUploadGitHub: (params: { repo: string; version: string; package: string }) =>
    mockUseUploadGitHub(params),
}))

vi.mock('../../../base/loading', () => ({
  default: () => <div data-testid="loading">loading</div>,
}))

vi.mock('../loaded-item', () => ({
  default: (props: Record<string, unknown>) => {
    mockLoadedItem(props)
    return <div data-testid="loaded-item">loaded-item</div>
  },
}))

const dependency: GitHubItemAndMarketPlaceDependency = {
  type: 'github',
  value: {
    repo: 'dify/plugin',
    release: 'v1.0.0',
    package: 'plugin.zip',
  },
}

const versionInfo: VersionProps = {
  hasInstalled: false,
  installedVersion: '',
  toInstallVersion: '1.0.0',
}

describe('GithubItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state before payload is ready', () => {
    mockUseUploadGitHub.mockReturnValue({ data: null, error: null })

    render(
      <GithubItem
        checked={false}
        onCheckedChange={vi.fn()}
        dependency={dependency}
        versionInfo={versionInfo}
        onFetchedPayload={vi.fn()}
        onFetchError={vi.fn()}
      />,
    )

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(mockUseUploadGitHub).toHaveBeenCalledWith({
      repo: 'dify/plugin',
      version: 'v1.0.0',
      package: 'plugin.zip',
    })
  })

  it('converts fetched manifest and renders LoadedItem', async () => {
    const onFetchedPayload = vi.fn()
    const payload = {
      plugin_id: 'plugin-1',
      name: 'Plugin One',
      org: 'dify',
      icon: 'icon.png',
      version: '1.0.0',
    }

    mockUseUploadGitHub.mockReturnValue({
      data: {
        manifest: {
          ...createPluginEntity().declaration,
          name: 'Plugin One',
          author: 'dify',
          icon: 'icon.png',
        },
        unique_identifier: 'plugin-1',
      },
      error: null,
    })

    render(
      <GithubItem
        checked
        onCheckedChange={vi.fn()}
        dependency={dependency}
        versionInfo={versionInfo}
        onFetchedPayload={onFetchedPayload}
        onFetchError={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onFetchedPayload).toHaveBeenCalledWith(
        expect.objectContaining({ ...payload, label: { en_US: 'Plugin label' }, tags: [] }),
      )
      expect(screen.getByTestId('loaded-item')).toBeInTheDocument()
    })

    expect(mockLoadedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        checked: true,
        versionInfo,
        payload: expect.objectContaining({
          ...payload,
          from: 'github',
        }),
      }),
    )
  })

  it('reports fetch error from upload hook', async () => {
    const onFetchError = vi.fn()
    mockUseUploadGitHub.mockReturnValue({ data: null, error: new Error('boom') })

    render(
      <GithubItem
        checked={false}
        onCheckedChange={vi.fn()}
        dependency={dependency}
        versionInfo={versionInfo}
        onFetchedPayload={vi.fn()}
        onFetchError={onFetchError}
      />,
    )

    await waitFor(() => {
      expect(onFetchError).toHaveBeenCalledTimes(1)
    })
  })
})
