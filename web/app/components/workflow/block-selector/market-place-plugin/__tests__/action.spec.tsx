import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OperationDropdown from '../action'

const mockDownloadBlob = vi.fn()
const mockDownloadPlugin = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/service/client', () => ({
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

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderComponent = (props?: Partial<ComponentProps<typeof OperationDropdown>>) => {
  const queryClient = createQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <OperationDropdown
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

describe('OperationDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadPlugin.mockResolvedValue(new Blob(['plugin zip'], { type: 'application/zip' }))
  })

  it('should render download and view details actions when opened', async () => {
    renderComponent({ open: true })

    expect(screen.getByText('common.operation.download')).toBeInTheDocument()
    expect(screen.getByText('common.operation.viewDetails')).toBeInTheDocument()
  })

  it('should request a download when download is clicked', async () => {
    const onOpenChange = vi.fn()
    renderComponent({ open: true, onOpenChange })

    await userEvent.setup().click(screen.getByText('common.operation.download'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => {
      expect(mockDownloadPlugin).toHaveBeenCalledWith({
        params: {
          organization: 'langgenius',
          pluginName: 'test-plugin',
          version: '1.0.0',
        },
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

  it('should download the blob when the request returns data', async () => {
    renderComponent({ open: true })

    await userEvent.setup().click(screen.getByText('common.operation.download'))

    await waitFor(() => {
      expect(mockDownloadBlob).toHaveBeenCalledWith({
        data: expect.any(Blob),
        fileName: 'langgenius-test-plugin_1.0.0.zip',
      })
    })
  })

  it('should link to the marketplace detail page', () => {
    renderComponent({ open: true })

    expect(screen.getByRole('menuitem', { name: 'common.operation.viewDetails' })).toHaveAttribute(
      'href',
      'https://marketplace.example/plugins/langgenius/test-plugin',
    )
  })
})
