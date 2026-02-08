import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LabelFilter from './filter'

// Mock useTags hook with controlled test data
const mockTags = [
  { name: 'agent', label: 'Agent' },
  { name: 'rag', label: 'RAG' },
  { name: 'search', label: 'Search' },
  { name: 'image', label: 'Image' },
]

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: mockTags,
    tagsMap: mockTags.reduce((acc, tag) => ({ ...acc, [tag.name]: tag }), {}),
    getTagLabel: (name: string) => mockTags.find(t => t.name === name)?.label ?? name,
  }),
}))

// Mock useDebounceFn to store the function and allow manual triggering
let debouncedFn: (() => void) | null = null
vi.mock('ahooks', () => ({
  useDebounceFn: (fn: () => void) => {
    debouncedFn = fn
    return {
      run: () => {
        // Schedule to run after React state updates
        setTimeout(() => debouncedFn?.(), 0)
      },
      cancel: vi.fn(),
    }
  },
}))

describe('LabelFilter', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    debouncedFn = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Rendering Tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })

    it('should display placeholder when no labels selected', () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })

    it('should display selected label when one label is selected', () => {
      render(<LabelFilter value={['agent']} onChange={mockOnChange} />)

      expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    it('should display count badge when multiple labels are selected', () => {
      render(<LabelFilter value={['agent', 'rag', 'search']} onChange={mockOnChange} />)

      expect(screen.getByText('Agent')).toBeInTheDocument()
      expect(screen.getByText('+2')).toBeInTheDocument()
    })
  })

  // Dropdown Tests
  describe('Dropdown', () => {
    it('should open dropdown when trigger is clicked', async () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      const trigger = screen.getByText('common.tag.placeholder')

      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      mockTags.forEach((tag) => {
        expect(screen.getByText(tag.label)).toBeInTheDocument()
      })
    })

    it('should close dropdown when trigger is clicked again', async () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      const trigger = screen.getByText('common.tag.placeholder')

      // Open
      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('Agent')).toBeInTheDocument()

      // Close
      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  // Selection Tests
  describe('Selection', () => {
    it('should call onChange with selected label when clicking a label', async () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.tag.placeholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('Agent')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByText('Agent'))
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenCalledWith(['agent'])
    })

    it('should remove label from selection when clicking already selected label', async () => {
      render(<LabelFilter value={['agent']} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('Agent'))
        vi.advanceTimersByTime(10)
      })

      // Find the label item in the dropdown list
      const labelItems = screen.getAllByText('Agent')
      const dropdownItem = labelItems.find(el => el.closest('.hover\\:bg-state-base-hover'))

      await act(async () => {
        if (dropdownItem)
          fireEvent.click(dropdownItem)
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenCalledWith([])
    })

    it('should add label to existing selection', async () => {
      render(<LabelFilter value={['agent']} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('Agent'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('RAG')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByText('RAG'))
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenCalledWith(['agent', 'rag'])
    })
  })

  // Clear Tests
  describe('Clear', () => {
    it('should clear all selections when clear button is clicked', async () => {
      render(<LabelFilter value={['agent', 'rag']} onChange={mockOnChange} />)

      // Find and click the clear button (XCircle icon's parent)
      const clearButton = document.querySelector('.group\\/clear')
      expect(clearButton).toBeInTheDocument()

      fireEvent.click(clearButton!)

      expect(mockOnChange).toHaveBeenCalledWith([])
    })

    it('should not show clear button when no labels selected', () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      const clearButton = document.querySelector('.group\\/clear')
      expect(clearButton).not.toBeInTheDocument()
    })
  })

  // Search Tests
  describe('Search', () => {
    it('should filter labels based on search input by name', async () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.tag.placeholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByRole('textbox')).toBeInTheDocument()

      await act(async () => {
        const searchInput = screen.getByRole('textbox')
        // Filter by 'rag' which only matches 'rag' name
        fireEvent.change(searchInput, { target: { value: 'rag' } })
        vi.advanceTimersByTime(10)
      })

      // Only RAG should be visible (rag contains 'rag')
      expect(screen.getByTitle('RAG')).toBeInTheDocument()
      // Agent should not be in the dropdown list (agent doesn't contain 'rag')
      expect(screen.queryByTitle('Agent')).not.toBeInTheDocument()
    })

    it('should show empty state when no labels match search', async () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.tag.placeholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByRole('textbox')).toBeInTheDocument()

      await act(async () => {
        const searchInput = screen.getByRole('textbox')
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('common.tag.noTag')).toBeInTheDocument()
    })

    it('should show all labels when search is cleared', async () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.tag.placeholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByRole('textbox')).toBeInTheDocument()

      await act(async () => {
        const searchInput = screen.getByRole('textbox')
        // First filter to show only RAG
        fireEvent.change(searchInput, { target: { value: 'rag' } })
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTitle('RAG')).toBeInTheDocument()
      expect(screen.queryByTitle('Agent')).not.toBeInTheDocument()

      await act(async () => {
        // Clear the input
        const searchInput = screen.getByRole('textbox')
        fireEvent.change(searchInput, { target: { value: '' } })
        vi.advanceTimersByTime(10)
      })

      // All labels should be visible again
      expect(screen.getByTitle('Agent')).toBeInTheDocument()
      expect(screen.getByTitle('RAG')).toBeInTheDocument()
    })
  })

  // Edge Cases
  describe('Edge Cases', () => {
    it('should handle empty label list', async () => {
      // Temporarily mock empty tags
      vi.doMock('@/app/components/plugins/hooks', () => ({
        useTags: () => ({
          tags: [],
          tagsMap: {},
          getTagLabel: (name: string) => name,
        }),
      }))

      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    })

    it('should handle value with non-existent label', () => {
      render(<LabelFilter value={['nonexistent']} onChange={mockOnChange} />)

      // Should still render without crashing
      expect(document.querySelector('.text-text-tertiary')).toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    it('should receive value as array of strings', () => {
      render(<LabelFilter value={['agent', 'rag']} onChange={mockOnChange} />)

      expect(screen.getByText('Agent')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('should call onChange with updated array', async () => {
      render(<LabelFilter value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.tag.placeholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('Agent')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByText('Agent'))
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenCalledTimes(1)
      expect(mockOnChange).toHaveBeenCalledWith(['agent'])
    })
  })
})
