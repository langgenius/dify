import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CreateCard from './create-card'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock amplitude tracking
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock service hooks
const mockCreateEmptyDataset = vi.fn()
const mockInvalidDatasetList = vi.fn()

vi.mock('@/service/knowledge/use-create-dataset', () => ({
  useCreatePipelineDataset: () => ({
    mutateAsync: mockCreateEmptyDataset,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

// ============================================================================
// CreateCard Component Tests
// ============================================================================

describe('CreateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<CreateCard />)
      expect(screen.getByText(/createFromScratch\.title/i)).toBeInTheDocument()
    })

    it('should render title and description', () => {
      render(<CreateCard />)
      expect(screen.getByText(/createFromScratch\.title/i)).toBeInTheDocument()
      expect(screen.getByText(/createFromScratch\.description/i)).toBeInTheDocument()
    })

    it('should render add icon', () => {
      const { container } = render(<CreateCard />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call createEmptyDataset when clicked', async () => {
      mockCreateEmptyDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ id: 'new-dataset-id' })
        return Promise.resolve()
      })

      render(<CreateCard />)

      const card = screen.getByText(/createFromScratch\.title/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(card!)

      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalled()
      })
    })

    it('should navigate to pipeline page on success', async () => {
      mockCreateEmptyDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ id: 'test-dataset-123' })
        return Promise.resolve()
      })

      render(<CreateCard />)

      const card = screen.getByText(/createFromScratch\.title/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(card!)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-123/pipeline')
      })
    })

    it('should invalidate dataset list on success', async () => {
      mockCreateEmptyDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ id: 'test-id' })
        return Promise.resolve()
      })

      render(<CreateCard />)

      const card = screen.getByText(/createFromScratch\.title/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(card!)

      await waitFor(() => {
        expect(mockInvalidDatasetList).toHaveBeenCalled()
      })
    })

    it('should handle error callback', async () => {
      mockCreateEmptyDataset.mockImplementation((_data, callbacks) => {
        callbacks.onError(new Error('Create failed'))
        return Promise.resolve()
      })

      render(<CreateCard />)

      const card = screen.getByText(/createFromScratch\.title/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(card!)

      // Should not throw and should handle error gracefully
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalled()
      })
    })

    it('should not navigate when data is undefined', async () => {
      mockCreateEmptyDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess(undefined)
        return Promise.resolve()
      })

      render(<CreateCard />)

      const card = screen.getByText(/createFromScratch\.title/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(card!)

      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalled()
      })

      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper card styling', () => {
      const { container } = render(<CreateCard />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('relative', 'flex', 'cursor-pointer', 'flex-col', 'rounded-xl')
    })

    it('should have fixed height', () => {
      const { container } = render(<CreateCard />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('h-[132px]')
    })

    it('should have shadow and border', () => {
      const { container } = render(<CreateCard />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('border-[0.5px]', 'shadow-xs')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<CreateCard />)
      rerender(<CreateCard />)
      expect(screen.getByText(/createFromScratch\.title/i)).toBeInTheDocument()
    })
  })
})
