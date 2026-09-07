import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import LabelSelector from '../selector'

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
    getTagLabel: (name: string) => mockTags.find((t) => t.name === name)?.label ?? name,
  }),
}))

describe('LabelSelector', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Rendering Tests
  describe('Rendering', () => {
    it('should display placeholder when no labels selected', () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      expect(screen.getByText('tools.createTool.toolInput.labelPlaceholder')).toBeInTheDocument()
    })

    it('should render the trigger as a native button', () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      expect(
        screen.getByRole('button', { name: 'tools.createTool.toolInput.labelPlaceholder' }),
      ).toHaveAttribute('type', 'button')
    })

    it('should display selected labels as comma-separated list', () => {
      render(<LabelSelector value={['agent', 'rag']} onChange={mockOnChange} />)

      expect(screen.getByText('Agent, RAG')).toBeInTheDocument()
    })

    it('should display single selected label', () => {
      render(<LabelSelector value={['agent']} onChange={mockOnChange} />)

      expect(screen.getByText('Agent')).toBeInTheDocument()
    })
  })

  // Dropdown Tests
  describe('Dropdown', () => {
    it('should open dropdown when trigger is clicked', async () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      const trigger = screen.getByText('tools.createTool.toolInput.labelPlaceholder')

      await act(async () => {
        fireEvent.click(trigger)
        vi.advanceTimersByTime(10)
      })

      // Checkboxes should be visible
      mockTags.forEach((tag) => {
        expect(screen.getByText(tag.label)).toBeInTheDocument()
      })
    })

    it('should close dropdown when trigger is clicked again', async () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      const trigger = screen.getByText('tools.createTool.toolInput.labelPlaceholder')

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

      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    })
  })

  // Selection Tests
  describe('Selection', () => {
    it('should call onChange with selected label when clicking a label', async () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('tools.createTool.toolInput.labelPlaceholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('Agent')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Agent' }))
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenCalledWith(['agent'])
    })

    it('should remove label from selection when clicking already selected label', async () => {
      render(<LabelSelector value={['agent']} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('Agent'))
        vi.advanceTimersByTime(10)
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Agent' }))
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenCalledWith([])
    })

    it('should add label to existing selection', async () => {
      render(<LabelSelector value={['agent']} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('Agent'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByRole('checkbox', { name: 'RAG' })).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'RAG' }))
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenCalledWith(['agent', 'rag'])
    })

    it('should show checkboxes in dropdown', async () => {
      render(<LabelSelector value={['agent']} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('Agent'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    })
  })

  // Search Tests
  describe('Search', () => {
    it('should filter labels based on search input by name', async () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('tools.createTool.toolInput.labelPlaceholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toBeInTheDocument()

      await act(async () => {
        const searchInput = screen.getByRole('searchbox', { name: 'common.operation.search' })
        // Filter by 'rag' which only matches 'rag' name
        fireEvent.change(searchInput, { target: { value: 'rag' } })
        vi.advanceTimersByTime(500)
      })

      // Only RAG should be visible (rag contains 'rag')
      expect(screen.getByText('RAG')).toBeInTheDocument()
      // Agent should not be in the dropdown list (agent doesn't contain 'rag')
      expect(screen.queryByRole('checkbox', { name: 'Agent' })).not.toBeInTheDocument()
    })

    it('should show empty state when no labels match search', async () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('tools.createTool.toolInput.labelPlaceholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toBeInTheDocument()

      await act(async () => {
        const searchInput = screen.getByRole('searchbox', { name: 'common.operation.search' })
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
        vi.advanceTimersByTime(500)
      })

      expect(screen.getByText('common.tag.noTag')).toBeInTheDocument()
    })

    it('should show all labels when search is cleared', async () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('tools.createTool.toolInput.labelPlaceholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toBeInTheDocument()

      await act(async () => {
        const searchInput = screen.getByRole('searchbox', { name: 'common.operation.search' })
        // First filter to show only RAG
        fireEvent.change(searchInput, { target: { value: 'rag' } })
        vi.advanceTimersByTime(500)
      })

      expect(screen.getByText('RAG')).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Agent' })).not.toBeInTheDocument()

      await act(async () => {
        // Clear the input
        const searchInput = screen.getByRole('searchbox', { name: 'common.operation.search' })
        fireEvent.change(searchInput, { target: { value: '' } })
        vi.advanceTimersByTime(10)
      })

      // All labels should be visible again
      expect(screen.getByRole('checkbox', { name: 'Agent' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'RAG' })).toBeInTheDocument()
    })
  })

  // Edge Cases
  describe('Edge Cases', () => {
    it('should handle empty label list', () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      expect(screen.getByText('tools.createTool.toolInput.labelPlaceholder')).toBeInTheDocument()
    })

    it('should handle multiple labels display', () => {
      render(<LabelSelector value={['agent', 'rag', 'search']} onChange={mockOnChange} />)

      expect(screen.getByText('Agent, RAG, Search')).toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    it('should receive value as array of strings', () => {
      render(<LabelSelector value={['agent', 'rag']} onChange={mockOnChange} />)

      expect(screen.getByText('Agent, RAG')).toBeInTheDocument()
    })

    it('should call onChange with updated array', async () => {
      render(<LabelSelector value={[]} onChange={mockOnChange} />)

      await act(async () => {
        fireEvent.click(screen.getByText('tools.createTool.toolInput.labelPlaceholder'))
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByText('Agent')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Agent' }))
        vi.advanceTimersByTime(10)
      })

      expect(mockOnChange).toHaveBeenLastCalledWith(['agent'])
    })
  })
})
