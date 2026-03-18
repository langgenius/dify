import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import GlobalPublicStoreProvider, { useGlobalPublicStore } from '@/context/global-public-context'
import { defaultSystemFeatures } from '@/types/feature'

const mockSystemFeatures = vi.fn()
const mockFetchSetupStatusWithCache = vi.fn()

vi.mock('@/service/client', () => ({
  consoleClient: {
    systemFeatures: () => mockSystemFeatures(),
  },
}))

vi.mock('@/utils/setup-status', () => ({
  fetchSetupStatusWithCache: () => mockFetchSetupStatusWithCache(),
}))

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderProvider = () => {
  const queryClient = createQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <GlobalPublicStoreProvider>
        <div>provider child</div>
      </GlobalPublicStoreProvider>
    </QueryClientProvider>,
  )
}

describe('GlobalPublicStoreProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGlobalPublicStore.setState({ systemFeatures: defaultSystemFeatures })
    mockFetchSetupStatusWithCache.mockResolvedValue({ setup_status: 'finished' })
  })

  describe('Rendering', () => {
    it('should render children when system features are still loading', async () => {
      mockSystemFeatures.mockReturnValue(new Promise(() => {}))

      renderProvider()

      expect(screen.getByText('provider child')).toBeInTheDocument()
      await waitFor(() => {
        expect(mockSystemFeatures).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('State Updates', () => {
    it('should update the public store when system features query succeeds', async () => {
      mockSystemFeatures.mockResolvedValue({
        ...defaultSystemFeatures,
        enable_marketplace: true,
      })

      renderProvider()

      await waitFor(() => {
        expect(useGlobalPublicStore.getState().systemFeatures.enable_marketplace).toBe(true)
      })
      expect(mockFetchSetupStatusWithCache).toHaveBeenCalledTimes(1)
    })
  })
})
