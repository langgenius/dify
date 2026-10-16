import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import CreateCard from '../create-card'

const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock amplitude tracking
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
      error: mockToastError,
    },
  }
})

const mockCreateEmptyDataset = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'rag.pipeline.emptyDataset.post': () => ({ mutateAsync: mockCreateEmptyDataset }),
  })
})

// CreateCard Component Tests

describe('CreateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToastSuccess.mockReset()
    mockToastError.mockReset()
  })

  describe('Rendering', () => {
    it('should render title and description', () => {
      renderWithConsoleQuery(<CreateCard />)
      expect(screen.getByText(/createFromScratch\.title/i)).toBeInTheDocument()
      expect(screen.getByText(/createFromScratch\.description/i)).toBeInTheDocument()
    })

    it('should render add icon', () => {
      const { container } = renderWithConsoleQuery(<CreateCard />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('should have fixed height', () => {
      const { container } = renderWithConsoleQuery(<CreateCard />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('h-33')
    })

    it('should have shadow and border', () => {
      const { container } = renderWithConsoleQuery(<CreateCard />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('border-[0.5px]', 'shadow-xs')
    })
  })
})
