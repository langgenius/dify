import type { AccountIntegrate } from '@/models/common'
import { render, screen } from '@testing-library/react'
import { useAccountIntegrates } from '@/service/use-common'
import IntegrationsPage from './index'

vi.mock('@/service/use-common', () => ({
  useAccountIntegrates: vi.fn(),
}))

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering connected integrations', () => {
    it('should render connected integrations when list is provided', () => {
      // Arrange
      const mockData: AccountIntegrate[] = [
        { provider: 'google', is_bound: true, link: '', created_at: 1678888888 },
        { provider: 'github', is_bound: true, link: '', created_at: 1678888888 },
      ]

      vi.mocked(useAccountIntegrates).mockReturnValue({
        data: {
          data: mockData,
        },
        isPending: false,
        isError: false,
      } as unknown as ReturnType<typeof useAccountIntegrates>)

      // Act
      render(<IntegrationsPage />)

      // Assert
      expect(screen.getByText('common.integrations.connected')).toBeInTheDocument()
      expect(screen.getByText('common.integrations.google')).toBeInTheDocument()
      expect(screen.getByText('common.integrations.github')).toBeInTheDocument()
      // Connect link should not be present when bound
      expect(screen.queryByText('common.integrations.connect')).not.toBeInTheDocument()
    })
  })

  describe('Unbound integrations', () => {
    it('should render connect link for unbound integrations', () => {
      // Arrange
      const mockData: AccountIntegrate[] = [
        { provider: 'google', is_bound: false, link: 'https://google.com', created_at: 1678888888 },
      ]

      vi.mocked(useAccountIntegrates).mockReturnValue({
        data: {
          data: mockData,
        },
        isPending: false,
        isError: false,
      } as unknown as ReturnType<typeof useAccountIntegrates>)

      // Act
      render(<IntegrationsPage />)

      // Assert
      expect(screen.getByText('common.integrations.google')).toBeInTheDocument()
      const connectLink = screen.getByText('common.integrations.connect')
      expect(connectLink).toBeInTheDocument()
      expect(connectLink.closest('a')).toHaveAttribute('href', 'https://google.com')
    })
  })

  describe('Edge cases', () => {
    it('should render nothing when no integrations are provided', () => {
      // Arrange
      vi.mocked(useAccountIntegrates).mockReturnValue({
        data: {
          data: [],
        },
        isPending: false,
        isError: false,
      } as unknown as ReturnType<typeof useAccountIntegrates>)

      // Act
      render(<IntegrationsPage />)

      // Assert
      expect(screen.getByText('common.integrations.connected')).toBeInTheDocument()
      expect(screen.queryByText('common.integrations.google')).not.toBeInTheDocument()
      expect(screen.queryByText('common.integrations.github')).not.toBeInTheDocument()
    })

    it('should handle unknown providers gracefully', () => {
      // Arrange
      const mockData = [
        { provider: 'unknown', is_bound: false, link: '', created_at: 1678888888 } as unknown as AccountIntegrate,
      ]

      vi.mocked(useAccountIntegrates).mockReturnValue({
        data: {
          data: mockData,
        },
        isPending: false,
        isError: false,
      } as unknown as ReturnType<typeof useAccountIntegrates>)

      // Act
      render(<IntegrationsPage />)

      // Assert
      expect(screen.queryByText('common.integrations.connect')).not.toBeInTheDocument()
    })

    it('should handle undefined data gracefully', () => {
      // Arrange
      vi.mocked(useAccountIntegrates).mockReturnValue({
        data: undefined,
        isPending: false,
        isError: false,
      } as unknown as ReturnType<typeof useAccountIntegrates>)

      // Act
      render(<IntegrationsPage />)

      // Assert
      expect(screen.getByText('common.integrations.connected')).toBeInTheDocument()
      expect(screen.queryByText('common.integrations.google')).not.toBeInTheDocument()
    })
  })
})
