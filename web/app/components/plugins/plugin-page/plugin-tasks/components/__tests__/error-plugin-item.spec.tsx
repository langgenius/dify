import type { PluginInfoFromMarketPlace, PluginStatus } from '@/app/components/plugins/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginCategoryEnum, PluginSource, TaskStatus } from '@/app/components/plugins/types'
import { fetchPluginInfoFromMarketPlace } from '@/service/plugins'

import ErrorPluginItem from '../error-plugin-item'

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src, size }: { src: string, size: string }) => (
    <div data-testid="card-icon" data-src={src} data-size={size} />
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ uniqueIdentifier, onClose, onSuccess }: { uniqueIdentifier: string, onClose: () => void, onSuccess: () => void }) => (
    <div data-testid="install-modal" data-uid={uniqueIdentifier}>
      <button onClick={onClose}>Close modal</button>
      <button onClick={onSuccess}>Success</button>
    </div>
  ),
}))

vi.mock('@/service/plugins', () => ({
  fetchPluginInfoFromMarketPlace: vi.fn(),
}))

const mockFetch = vi.mocked(fetchPluginInfoFromMarketPlace)
const mockGetIconUrl = vi.fn((icon: string) => `https://icons/${icon}`)

function createMarketplaceResponse(identifier: string, version: string) {
  return {
    data: {
      plugin: {
        category: PluginCategoryEnum.tool,
        latest_package_identifier: identifier,
        latest_version: version,
      } satisfies PluginInfoFromMarketPlace,
      version: { version },
    },
  }
}

const createPlugin = (overrides: Partial<PluginStatus> = {}): PluginStatus => ({
  plugin_unique_identifier: 'org/plugin:1.0.0',
  plugin_id: 'org/plugin',
  source: PluginSource.marketplace,
  status: TaskStatus.failed,
  message: '',
  icon: 'icon.png',
  labels: { en_US: 'Test Plugin' } as PluginStatus['labels'],
  taskId: 'task-1',
  ...overrides,
})

describe('ErrorPluginItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render plugin name', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    })

    it('should render error status icon', () => {
      const { container } = render(
        <ErrorPluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(container.querySelector('.i-ri-error-warning-fill')).toBeInTheDocument()
    })

    it('should apply destructive text styling', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      const errorText = screen.getByText(/plugin\.task\.errorMsg\.marketplace/i)
      expect(errorText.closest('.text-text-destructive')).toBeInTheDocument()
    })
  })

  describe('Source detection and error messages', () => {
    it('should show marketplace error message for marketplace plugins', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.marketplace, plugin_id: 'org/my-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.errorMsg\.marketplace/)).toBeInTheDocument()
    })

    it('should show github error message for github plugins', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.github, plugin_id: 'https://github.com/user/repo' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.errorMsg\.github/)).toBeInTheDocument()
    })

    it('should show unknown error message for unknown source plugins', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.local, plugin_id: 'local-only-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.errorMsg\.unknown/)).toBeInTheDocument()
    })

    it('should show plugin.message when available instead of default error', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ message: 'Custom error occurred' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText('Custom error occurred')).toBeInTheDocument()
    })
  })

  describe('Action buttons', () => {
    it('should show "Install from Marketplace" button for marketplace plugins', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.marketplace, plugin_id: 'org/my-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.installFromMarketplace/)).toBeInTheDocument()
    })

    it('should show "Install from GitHub" button for github plugins', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.github, plugin_id: 'https://github.com/user/repo' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.installFromGithub/)).toBeInTheDocument()
    })

    it('should not show action button for unknown source plugins', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.local, plugin_id: 'local-only-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.queryByText(/plugin\.task\.installFrom/)).not.toBeInTheDocument()
    })

    it('should use source instead of plugin_id heuristics when deciding button text', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.github, plugin_id: 'org/my-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.installFromGithub/)).toBeInTheDocument()
      expect(screen.queryByText(/plugin\.task\.installFromMarketplace/)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClear when clear button is clicked', () => {
      const onClear = vi.fn()
      render(
        <ErrorPluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={onClear}
        />,
      )

      // The clear button (×) is from PluginItem
      const buttons = screen.getAllByRole('button')
      const clearButton = buttons.find(btn => !btn.textContent?.includes('plugin.task'))
      fireEvent.click(clearButton!)

      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should fetch marketplace info and show install modal on button click', async () => {
      mockFetch.mockResolvedValueOnce(createMarketplaceResponse('org/my-plugin:2.0.0', '2.0.0'))

      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.marketplace, plugin_id: 'org/my-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText(/plugin\.task\.installFromMarketplace/))

      await waitFor(() => {
        expect(screen.getByTestId('install-modal')).toBeInTheDocument()
      })

      expect(mockFetch).toHaveBeenCalledWith({ org: 'org', name: 'my-plugin' })
      expect(screen.getByTestId('install-modal')).toHaveAttribute('data-uid', 'org/my-plugin:2.0.0')
    })

    it('should close install modal when onClose is called', async () => {
      mockFetch.mockResolvedValueOnce(createMarketplaceResponse('org/my-plugin:2.0.0', '2.0.0'))

      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.marketplace, plugin_id: 'org/my-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText(/plugin\.task\.installFromMarketplace/))

      await waitFor(() => {
        expect(screen.getByTestId('install-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Close modal'))

      expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
    })

    it('should silently handle fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.marketplace, plugin_id: 'org/my-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText(/plugin\.task\.installFromMarketplace/))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })

      expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
    })

    it('should not fetch when plugin_id has fewer than 2 parts', async () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.local, plugin_id: 'single-part' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      // Unknown source won't render the marketplace button, so nothing to click
      expect(screen.queryByText(/plugin\.task\.installFromMarketplace/)).not.toBeInTheDocument()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should render github action when source is github even if plugin_id looks like a URL', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.github, plugin_id: 'http://github.com/user/repo' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.installFromGithub/)).toBeInTheDocument()
    })

    it('should close install modal and clear the error item when onSuccess is called', async () => {
      mockFetch.mockResolvedValueOnce(createMarketplaceResponse('org/p:1.0.0', '1.0.0'))
      const onClear = vi.fn()

      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.marketplace, plugin_id: 'org/p' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={onClear}
        />,
      )

      fireEvent.click(screen.getByText(/plugin\.task\.installFromMarketplace/))

      await waitFor(() => {
        expect(screen.getByTestId('install-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Success'))

      expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should show unknown action state for local source even if id contains github keyword', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.local, plugin_id: 'my-github-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.queryByText(/plugin\.task\.installFromGithub/)).not.toBeInTheDocument()
      expect(screen.getByText(/plugin\.task\.errorMsg\.unknown/)).toBeInTheDocument()
    })

    it('should show unknown error message for debugging source plugins', () => {
      render(
        <ErrorPluginItem
          plugin={createPlugin({ source: PluginSource.debugging, plugin_id: 'remote-plugin' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          onClear={vi.fn()}
        />,
      )

      expect(screen.getByText(/plugin\.task\.errorMsg\.unknown/)).toBeInTheDocument()
      expect(screen.queryByText(/plugin\.task\.installFrom/)).not.toBeInTheDocument()
    })
  })
})
