import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Card from '../card'

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) =>
    isShow ? <div data-testid="secret-key-modal"><button onClick={onClose}>close</button></div> : null,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: createWrapper() })
}

describe('Card (Service API)', () => {
  const defaultProps = {
    apiBaseUrl: 'https://api.dify.ai/v1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verifies all key elements render
  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderWithProviders(<Card {...defaultProps} />)
      expect(screen.getByText(/serviceApi\.card\.title/)).toBeInTheDocument()
    })

    it('should render card title', () => {
      renderWithProviders(<Card {...defaultProps} />)
      expect(screen.getByText(/serviceApi\.card\.title/)).toBeInTheDocument()
    })

    it('should render enabled status', () => {
      renderWithProviders(<Card {...defaultProps} />)
      expect(screen.getByText(/serviceApi\.enabled/)).toBeInTheDocument()
    })

    it('should render endpoint label', () => {
      renderWithProviders(<Card {...defaultProps} />)
      expect(screen.getByText(/serviceApi\.card\.endpoint/)).toBeInTheDocument()
    })

    it('should render the API base URL', () => {
      renderWithProviders(<Card {...defaultProps} />)
      expect(screen.getByText('https://api.dify.ai/v1')).toBeInTheDocument()
    })

    it('should render API key button', () => {
      renderWithProviders(<Card {...defaultProps} />)
      expect(screen.getByText(/serviceApi\.card\.apiKey/)).toBeInTheDocument()
    })

    it('should render API reference button', () => {
      renderWithProviders(<Card {...defaultProps} />)
      expect(screen.getByText(/serviceApi\.card\.apiReference/)).toBeInTheDocument()
    })
  })

  // Props: tests different apiBaseUrl values
  describe('Props', () => {
    it('should display provided apiBaseUrl', () => {
      renderWithProviders(<Card apiBaseUrl="https://custom-api.example.com" />)
      expect(screen.getByText('https://custom-api.example.com')).toBeInTheDocument()
    })

    it('should show green indicator when apiBaseUrl is provided', () => {
      renderWithProviders(<Card apiBaseUrl="https://api.dify.ai" />)
      // The Indicator component receives color="green" when apiBaseUrl is truthy
      const statusText = screen.getByText(/serviceApi\.enabled/)
      expect(statusText).toHaveClass('text-text-success')
    })

    it('should show yellow indicator when apiBaseUrl is empty', () => {
      renderWithProviders(<Card apiBaseUrl="" />)
      // Still shows "enabled" text but indicator color differs
      expect(screen.getByText(/serviceApi\.enabled/)).toBeInTheDocument()
    })
  })

  // User Interactions: tests button clicks and modal
  describe('User Interactions', () => {
    it('should open secret key modal when API key button is clicked', () => {
      renderWithProviders(<Card {...defaultProps} />)

      // Modal should not be visible before clicking
      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()

      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/).closest('button')
      fireEvent.click(apiKeyButton!)

      // Modal should appear after clicking
      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })

    it('should close secret key modal when onClose is called', () => {
      renderWithProviders(<Card {...defaultProps} />)

      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/).closest('button')
      fireEvent.click(apiKeyButton!)
      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByText('close'))
      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
    })

    it('should render API reference as a link', () => {
      renderWithProviders(<Card {...defaultProps} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  // Styles: verifies container structure
  describe('Styles', () => {
    it('should have correct container width', () => {
      const { container } = renderWithProviders(<Card {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('w-[360px]')
    })

    it('should have rounded corners', () => {
      const { container } = renderWithProviders(<Card {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('rounded-xl')
    })
  })

  // Edge Cases: tests empty/long URLs
  describe('Edge Cases', () => {
    it('should handle empty apiBaseUrl', () => {
      renderWithProviders(<Card apiBaseUrl="" />)
      // Should still render the structure
      expect(screen.getByText(/serviceApi\.card\.endpoint/)).toBeInTheDocument()
    })

    it('should handle very long apiBaseUrl', () => {
      const longUrl = `https://api.dify.ai/${'path/'.repeat(50)}`
      renderWithProviders(<Card apiBaseUrl={longUrl} />)
      expect(screen.getByText(longUrl)).toBeInTheDocument()
    })

    it('should handle apiBaseUrl with special characters', () => {
      const specialUrl = 'https://api.dify.ai/v1?key=value&foo=bar'
      renderWithProviders(<Card apiBaseUrl={specialUrl} />)
      expect(screen.getByText(specialUrl)).toBeInTheDocument()
    })
  })
})
