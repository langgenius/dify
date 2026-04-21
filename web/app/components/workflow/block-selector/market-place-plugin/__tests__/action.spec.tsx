import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDownloadPlugin } from '@/service/use-plugins'
import OperationDropdown from '../action'

const mockDownloadBlob = vi.fn()
const mockRemoveQueries = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useDownloadPlugin: vi.fn(),
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
  vi.spyOn(queryClient, 'removeQueries').mockImplementation(((...args) => {
    return mockRemoveQueries(...args)
  }) as typeof queryClient.removeQueries)

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
    vi.mocked(useDownloadPlugin).mockImplementation((_, enabled) => ({
      data: enabled ? null : null,
      isLoading: false,
    }) as unknown as ReturnType<typeof useDownloadPlugin>)
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
    expect(mockRemoveQueries).toHaveBeenCalled()
  })

  it('should skip download when already loading', async () => {
    vi.mocked(useDownloadPlugin).mockReturnValue({
      data: null,
      isLoading: true,
    } as unknown as ReturnType<typeof useDownloadPlugin>)

    renderComponent({ open: true })

    await userEvent.setup().click(screen.getByText('common.operation.download'))

    expect(mockRemoveQueries).not.toHaveBeenCalled()
  })

  it('should download the blob when the hook returns data', async () => {
    vi.mocked(useDownloadPlugin).mockImplementation((_, enabled) => ({
      data: enabled ? new Blob(['plugin zip'], { type: 'application/zip' }) : null,
      isLoading: false,
    }) as unknown as ReturnType<typeof useDownloadPlugin>)

    renderComponent({ open: true })

    await userEvent.setup().click(screen.getByText('common.operation.download'))

    await waitFor(() => {
      expect(mockDownloadBlob).toHaveBeenCalledWith({
        data: expect.any(Blob),
        fileName: 'langgenius-test-plugin_1.0.0.zip',
      })
    })
    expect(mockRemoveQueries).toHaveBeenCalled()
  })

  it('should link to the marketplace detail page', () => {
    renderComponent({ open: true })

    expect(screen.getByRole('menuitem', { name: 'common.operation.viewDetails' })).toHaveAttribute(
      'href',
      'https://marketplace.example/plugins/langgenius/test-plugin',
    )
  })
})
