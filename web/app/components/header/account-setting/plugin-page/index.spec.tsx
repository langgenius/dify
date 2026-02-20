import { render, screen } from '@testing-library/react'
import PluginPage from './index'

const mockUsePluginProviders = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@/service/use-common', () => ({
  usePluginProviders: mockUsePluginProviders,
}))

vi.mock('./SerpapiPlugin', () => ({
  default: ({ plugin }: { plugin: { tool_name: string } }) => (
    <div data-testid="status-indicator">{plugin.tool_name}</div>
  ),
}))

describe('PluginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render available plugins', () => {
    mockUsePluginProviders.mockReturnValue({
      data: [
        { tool_name: 'serpapi', credentials: { api_key: 'test-key' } },
      ],
      refetch: vi.fn(),
    })

    render(<PluginPage />)
    expect(screen.getByTestId('status-indicator')).toBeInTheDocument()
  })

  it('should display encryption notice with PKCS1_OAEP link', () => {
    mockUsePluginProviders.mockReturnValue({
      data: [],
      refetch: vi.fn(),
    })

    render(<PluginPage />)
    expect(screen.getByText(/provider.encrypted.front/)).toBeInTheDocument()
    expect(screen.getByText(/provider.encrypted.back/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'PKCS1_OAEP' })
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should handle empty plugin list', () => {
    mockUsePluginProviders.mockReturnValue({
      data: [],
      refetch: vi.fn(),
    })

    render(<PluginPage />)
    expect(screen.getByText(/provider.encrypted.front/)).toBeInTheDocument()
  })
})
