import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HomeBanner } from '../home-banner'

const mocks = vi.hoisted(() => ({
  getBanners: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    explore: {
      banners: {
        get: {
          queryOptions: () => ({
            queryKey: ['explore', 'banners'],
            queryFn: mocks.getBanners,
            retry: false,
          }),
        },
      },
    },
  },
}))

vi.mock('../banner', () => ({
  Banner: () => <div data-testid="home-banner" />,
}))

describe('HomeBanner', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  function renderHome() {
    return render(
      <QueryClientProvider client={queryClient}>
        <div>Main content</div>
        <HomeBanner />
      </QueryClientProvider>,
    )
  }

  it('renders the banner after its optional query succeeds', async () => {
    mocks.getBanners.mockResolvedValue([{ id: 'banner-1' }])

    renderHome()

    expect(await screen.findByTestId('home-banner')).toBeInTheDocument()
    expect(screen.getByText('Main content')).toBeInTheDocument()
  })

  it('keeps the main content available when the banner query fails', async () => {
    mocks.getBanners.mockRejectedValue(new Error('Banners unavailable'))

    renderHome()

    expect(screen.getByText('Main content')).toBeInTheDocument()
    expect(screen.queryByTestId('home-banner')).toBeNull()
    await waitFor(() => {
      expect(queryClient.getQueryState(['explore', 'banners'])?.status).toBe('error')
    })
    expect(screen.getByText('Main content')).toBeInTheDocument()
    expect(screen.queryByTestId('home-banner')).toBeNull()
  })
})
