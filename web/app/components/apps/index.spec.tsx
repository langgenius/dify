import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import * as React from 'react'

// Import after mocks
import Apps from './index'

// Track mock calls
let documentTitleCalls: string[] = []
let educationInitCalls: number = 0

// Mock useDocumentTitle hook
vi.mock('@/hooks/use-document-title', () => ({
  default: (title: string) => {
    documentTitleCalls.push(title)
  },
}))

// Mock useEducationInit hook
vi.mock('@/app/education-apply/hooks', () => ({
  useEducationInit: () => {
    educationInitCalls++
  },
}))

vi.mock('@/hooks/use-import-dsl', () => ({
  useImportDSL: () => ({
    handleImportDSL: vi.fn(),
    handleImportDSLConfirm: vi.fn(),
    versions: [],
    isFetching: false,
  }),
}))

// Mock List component
vi.mock('./list', () => ({
  default: () => {
    return React.createElement('div', { 'data-testid': 'apps-list' }, 'Apps List')
  },
}))

describe('Apps', () => {
  const createQueryClient = () => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  const renderWithClient = (ui: React.ReactElement) => {
    const queryClient = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    return {
      queryClient,
      ...render(ui, { wrapper }),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    documentTitleCalls = []
    educationInitCalls = 0
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderWithClient(<Apps />)
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()
    })

    it('should render List component', () => {
      renderWithClient(<Apps />)
      expect(screen.getByText('Apps List')).toBeInTheDocument()
    })

    it('should have correct container structure', () => {
      const { container } = renderWithClient(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('relative', 'flex', 'h-0', 'shrink-0', 'grow', 'flex-col')
    })
  })

  describe('Hooks', () => {
    it('should call useDocumentTitle with correct title', () => {
      renderWithClient(<Apps />)
      expect(documentTitleCalls).toContain('common.menus.apps')
    })

    it('should call useEducationInit', () => {
      renderWithClient(<Apps />)
      expect(educationInitCalls).toBeGreaterThan(0)
    })
  })

  describe('Integration', () => {
    it('should render full component tree', () => {
      renderWithClient(<Apps />)

      // Verify container exists
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()

      // Verify hooks were called
      expect(documentTitleCalls.length).toBeGreaterThanOrEqual(1)
      expect(educationInitCalls).toBeGreaterThanOrEqual(1)
    })

    it('should handle multiple renders', () => {
      const queryClient = createQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <Apps />
        </QueryClientProvider>,
      )
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()

      rerender(
        <QueryClientProvider client={queryClient}>
          <Apps />
        </QueryClientProvider>,
      )
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have overflow-y-auto class', () => {
      const { container } = renderWithClient(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('overflow-y-auto')
    })

    it('should have background styling', () => {
      const { container } = renderWithClient(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('bg-background-body')
    })
  })
})
