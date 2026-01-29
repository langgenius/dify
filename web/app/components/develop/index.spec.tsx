import { render, screen } from '@testing-library/react'
import DevelopMain from './index'

// Mock the app store with a factory function to control state
const mockAppDetailValue: { current: unknown } = { current: undefined }
vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: unknown) => unknown) => {
    const state = { appDetail: mockAppDetailValue.current }
    return selector(state)
  },
}))

// Mock the Doc component since it has complex dependencies
vi.mock('@/app/components/develop/doc', () => ({
  default: ({ appDetail }: { appDetail: { name?: string } | null }) => (
    <div data-testid="doc-component">
      Doc Component -
      {appDetail?.name}
    </div>
  ),
}))

// Mock the ApiServer component
vi.mock('@/app/components/develop/ApiServer', () => ({
  default: ({ apiBaseUrl, appId }: { apiBaseUrl: string, appId: string }) => (
    <div data-testid="api-server">
      API Server -
      {apiBaseUrl}
      {' '}
      -
      {appId}
    </div>
  ),
}))

describe('DevelopMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetailValue.current = undefined
  })

  describe('loading state', () => {
    it('should show loading when appDetail is undefined', () => {
      mockAppDetailValue.current = undefined
      render(<DevelopMain appId="app-123" />)

      // Loading component renders with role="status"
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should show loading when appDetail is null', () => {
      mockAppDetailValue.current = null
      render(<DevelopMain appId="app-123" />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should have centered loading container', () => {
      mockAppDetailValue.current = undefined
      const { container } = render(<DevelopMain appId="app-123" />)

      const loadingContainer = container.querySelector('.flex.h-full.items-center.justify-center')
      expect(loadingContainer).toBeInTheDocument()
    })

    it('should have correct background on loading state', () => {
      mockAppDetailValue.current = undefined
      const { container } = render(<DevelopMain appId="app-123" />)

      const loadingContainer = container.querySelector('.bg-background-default')
      expect(loadingContainer).toBeInTheDocument()
    })
  })

  describe('with appDetail loaded', () => {
    const mockAppDetail = {
      id: 'app-123',
      name: 'Test Application',
      api_base_url: 'https://api.example.com/v1',
      mode: 'chat',
    }

    beforeEach(() => {
      mockAppDetailValue.current = mockAppDetail
    })

    it('should render ApiServer component', () => {
      render(<DevelopMain appId="app-123" />)
      expect(screen.getByTestId('api-server')).toBeInTheDocument()
    })

    it('should pass api_base_url to ApiServer', () => {
      render(<DevelopMain appId="app-123" />)
      expect(screen.getByTestId('api-server')).toHaveTextContent('https://api.example.com/v1')
    })

    it('should pass appId to ApiServer', () => {
      render(<DevelopMain appId="app-123" />)
      expect(screen.getByTestId('api-server')).toHaveTextContent('app-123')
    })

    it('should render Doc component', () => {
      render(<DevelopMain appId="app-123" />)
      expect(screen.getByTestId('doc-component')).toBeInTheDocument()
    })

    it('should pass appDetail to Doc component', () => {
      render(<DevelopMain appId="app-123" />)
      expect(screen.getByTestId('doc-component')).toHaveTextContent('Test Application')
    })

    it('should not show loading when appDetail exists', () => {
      render(<DevelopMain appId="app-123" />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  describe('layout structure', () => {
    const mockAppDetail = {
      id: 'app-123',
      name: 'Test Application',
      api_base_url: 'https://api.example.com',
      mode: 'chat',
    }

    beforeEach(() => {
      mockAppDetailValue.current = mockAppDetail
    })

    it('should have flex column layout', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer.className).toContain('flex')
      expect(mainContainer.className).toContain('flex-col')
    })

    it('should have relative positioning', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer.className).toContain('relative')
    })

    it('should have full height', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer.className).toContain('h-full')
    })

    it('should have overflow-hidden', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer.className).toContain('overflow-hidden')
    })
  })

  describe('header section', () => {
    const mockAppDetail = {
      id: 'app-123',
      name: 'Test Application',
      api_base_url: 'https://api.example.com',
      mode: 'chat',
    }

    beforeEach(() => {
      mockAppDetailValue.current = mockAppDetail
    })

    it('should have header with border', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.border-b')
      expect(header).toBeInTheDocument()
    })

    it('should have shrink-0 on header to prevent shrinking', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.shrink-0')
      expect(header).toBeInTheDocument()
    })

    it('should have horizontal padding on header', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.px-6')
      expect(header).toBeInTheDocument()
    })

    it('should have vertical padding on header', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.py-2')
      expect(header).toBeInTheDocument()
    })

    it('should have items centered in header', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.items-center')
      expect(header).toBeInTheDocument()
    })

    it('should have justify-between in header', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.justify-between')
      expect(header).toBeInTheDocument()
    })
  })

  describe('content section', () => {
    const mockAppDetail = {
      id: 'app-123',
      name: 'Test Application',
      api_base_url: 'https://api.example.com',
      mode: 'chat',
    }

    beforeEach(() => {
      mockAppDetailValue.current = mockAppDetail
    })

    it('should have grow class for content area', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const content = container.querySelector('.grow')
      expect(content).toBeInTheDocument()
    })

    it('should have overflow-auto for content scrolling', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const content = container.querySelector('.overflow-auto')
      expect(content).toBeInTheDocument()
    })

    it('should have horizontal padding on content', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const content = container.querySelector('.px-4')
      expect(content).toBeInTheDocument()
    })

    it('should have vertical padding on content', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const content = container.querySelector('.py-4')
      expect(content).toBeInTheDocument()
    })

    it('should have responsive padding', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const content = container.querySelector('[class*="sm:px-10"]')
      expect(content).toBeInTheDocument()
    })
  })

  describe('with different appIds', () => {
    const mockAppDetail = {
      id: 'app-456',
      name: 'Another App',
      api_base_url: 'https://another-api.com',
      mode: 'completion',
    }

    beforeEach(() => {
      mockAppDetailValue.current = mockAppDetail
    })

    it('should pass different appId to ApiServer', () => {
      render(<DevelopMain appId="app-456" />)
      expect(screen.getByTestId('api-server')).toHaveTextContent('app-456')
    })

    it('should handle app with different api_base_url', () => {
      render(<DevelopMain appId="app-456" />)
      expect(screen.getByTestId('api-server')).toHaveTextContent('https://another-api.com')
    })
  })

  describe('empty state handling', () => {
    it('should handle appDetail with minimal properties', () => {
      mockAppDetailValue.current = {
        api_base_url: 'https://api.test.com',
      }
      render(<DevelopMain appId="app-minimal" />)
      expect(screen.getByTestId('api-server')).toBeInTheDocument()
    })

    it('should handle appDetail with empty api_base_url', () => {
      mockAppDetailValue.current = {
        api_base_url: '',
        name: 'Empty URL App',
      }
      render(<DevelopMain appId="app-empty-url" />)
      expect(screen.getByTestId('api-server')).toBeInTheDocument()
    })
  })

  describe('title element', () => {
    const mockAppDetail = {
      id: 'app-123',
      name: 'Test Application',
      api_base_url: 'https://api.example.com',
      mode: 'chat',
    }

    beforeEach(() => {
      mockAppDetailValue.current = mockAppDetail
    })

    it('should have title div with correct styling', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const title = container.querySelector('.text-lg.font-medium.text-text-primary')
      expect(title).toBeInTheDocument()
    })

    it('should render empty title div', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const title = container.querySelector('.text-lg.font-medium.text-text-primary')
      expect(title?.textContent).toBe('')
    })
  })

  describe('border styling', () => {
    const mockAppDetail = {
      id: 'app-123',
      name: 'Test Application',
      api_base_url: 'https://api.example.com',
      mode: 'chat',
    }

    beforeEach(() => {
      mockAppDetailValue.current = mockAppDetail
    })

    it('should have solid border style', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.border-solid')
      expect(header).toBeInTheDocument()
    })

    it('should have divider regular color on border', () => {
      const { container } = render(<DevelopMain appId="app-123" />)
      const header = container.querySelector('.border-b-divider-regular')
      expect(header).toBeInTheDocument()
    })
  })
})
