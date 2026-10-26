import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import OperationMenu from '../action'

const mockDownloadBlob = vi.fn()
const mockDownloadPlugin = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/service/marketplace', () => ({
  marketplaceQuery: {
    downloadPlugin: {
      mutationOptions: (options = {}) => ({
        mutationFn: (input: unknown) => mockDownloadPlugin(input),
        ...options,
      }),
    },
  },
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.example${path}`,
}))

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

const renderComponent = (props?: Partial<ComponentProps<typeof OperationMenu>>) => {
  const queryClient = createQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <OperationMenu
        open={false}
        onOpenChange={vi.fn()}
        author="langgenius"
        name="test-plugin"
        version="1.0.0"
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('MarketplaceOperationMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadPlugin.mockResolvedValue(new Blob(['plugin zip'], { type: 'application/zip' }))
  })

  it('downloads the requested plugin version with its archive filename', async () => {
    const user = userEvent.setup()
    const archive = new Blob(['plugin zip'], { type: 'application/zip' })
    mockDownloadPlugin.mockResolvedValue(archive)
    const onOpenChange = vi.fn()
    renderComponent({ open: true, onOpenChange })

    await user.click(screen.getByText('common.operation.download'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => {
      expect(mockDownloadPlugin).toHaveBeenCalledWith({
        params: {
          organization: 'langgenius',
          pluginName: 'test-plugin',
          version: '1.0.0',
        },
      })
      expect(mockDownloadBlob).toHaveBeenCalledWith({
        data: archive,
        fileName: 'langgenius-test-plugin_1.0.0.zip',
      })
    })
  })

  it('should skip duplicate downloads while pending', async () => {
    mockDownloadPlugin.mockReturnValue(new Promise(() => {}))

    renderComponent({ open: true })

    const user = userEvent.setup()
    await user.click(screen.getByText('common.operation.download'))

    await waitFor(() => {
      expect(mockDownloadPlugin).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByText('common.operation.download'))

    expect(mockDownloadPlugin).toHaveBeenCalledTimes(1)
  })

  it('should link to the marketplace detail page', () => {
    renderComponent({ open: true })

    expect(screen.getByRole('menuitem', { name: 'common.operation.viewDetails' })).toHaveAttribute(
      'href',
      'https://marketplace.example/plugins/langgenius/test-plugin',
    )
  })
})
