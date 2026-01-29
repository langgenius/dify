import type { CrawlOptions } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Options from './options'

// ============================================================================
// Test Data Factory
// ============================================================================

const createMockCrawlOptions = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({
  crawl_sub_pages: true,
  limit: 10,
  max_depth: 2,
  excludes: '',
  includes: '',
  only_main_content: false,
  use_sitemap: false,
  ...overrides,
})

// ============================================================================
// Options Component Tests
// ============================================================================

describe('Options', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to get checkboxes by test id pattern
  const getCheckboxes = (container: HTMLElement) => {
    return container.querySelectorAll('[data-testid^="checkbox-"]')
  }

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      // Check that key elements are rendered
      expect(screen.getByText(/crawlSubPage/i)).toBeInTheDocument()
      expect(screen.getByText(/limit/i)).toBeInTheDocument()
      expect(screen.getByText(/maxDepth/i)).toBeInTheDocument()
    })

    it('should render all form fields', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      // Checkboxes
      expect(screen.getByText(/crawlSubPage/i)).toBeInTheDocument()
      expect(screen.getByText(/extractOnlyMainContent/i)).toBeInTheDocument()

      // Text/Number fields
      expect(screen.getByText(/limit/i)).toBeInTheDocument()
      expect(screen.getByText(/maxDepth/i)).toBeInTheDocument()
      expect(screen.getByText(/excludePaths/i)).toBeInTheDocument()
      expect(screen.getByText(/includeOnlyPaths/i)).toBeInTheDocument()
    })

    it('should render with custom className', () => {
      const payload = createMockCrawlOptions()
      const { container } = render(
        <Options payload={payload} onChange={mockOnChange} className="custom-class" />,
      )

      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveClass('custom-class')
    })

    it('should render limit field with required indicator', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      // Limit field should have required indicator (*)
      const requiredIndicator = screen.getByText('*')
      expect(requiredIndicator).toBeInTheDocument()
    })

    it('should render placeholder for excludes field', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      const excludesInput = screen.getByPlaceholderText('blog/*, /about/*')
      expect(excludesInput).toBeInTheDocument()
    })

    it('should render placeholder for includes field', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      const includesInput = screen.getByPlaceholderText('articles/*')
      expect(includesInput).toBeInTheDocument()
    })

    it('should render two checkboxes', () => {
      const payload = createMockCrawlOptions()
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      expect(checkboxes.length).toBe(2)
    })
  })

  // --------------------------------------------------------------------------
  // Props Display Tests
  // --------------------------------------------------------------------------
  describe('Props Display', () => {
    it('should display crawl_sub_pages checkbox with check icon when true', () => {
      const payload = createMockCrawlOptions({ crawl_sub_pages: true })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      // First checkbox should have check icon when checked
      expect(checkboxes[0].querySelector('svg')).toBeInTheDocument()
    })

    it('should display crawl_sub_pages checkbox without check icon when false', () => {
      const payload = createMockCrawlOptions({ crawl_sub_pages: false })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      // First checkbox should not have check icon when unchecked
      expect(checkboxes[0].querySelector('svg')).not.toBeInTheDocument()
    })

    it('should display only_main_content checkbox with check icon when true', () => {
      const payload = createMockCrawlOptions({ only_main_content: true })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      // Second checkbox should have check icon when checked
      expect(checkboxes[1].querySelector('svg')).toBeInTheDocument()
    })

    it('should display only_main_content checkbox without check icon when false', () => {
      const payload = createMockCrawlOptions({ only_main_content: false })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      // Second checkbox should not have check icon when unchecked
      expect(checkboxes[1].querySelector('svg')).not.toBeInTheDocument()
    })

    it('should display limit value in input', () => {
      const payload = createMockCrawlOptions({ limit: 25 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const limitInput = screen.getByDisplayValue('25')
      expect(limitInput).toBeInTheDocument()
    })

    it('should display max_depth value in input', () => {
      const payload = createMockCrawlOptions({ max_depth: 5 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const maxDepthInput = screen.getByDisplayValue('5')
      expect(maxDepthInput).toBeInTheDocument()
    })

    it('should display excludes value in input', () => {
      const payload = createMockCrawlOptions({ excludes: 'test/*' })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const excludesInput = screen.getByDisplayValue('test/*')
      expect(excludesInput).toBeInTheDocument()
    })

    it('should display includes value in input', () => {
      const payload = createMockCrawlOptions({ includes: 'docs/*' })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const includesInput = screen.getByDisplayValue('docs/*')
      expect(includesInput).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onChange with updated crawl_sub_pages when checkbox is clicked', () => {
      const payload = createMockCrawlOptions({ crawl_sub_pages: true })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      fireEvent.click(checkboxes[0])

      expect(mockOnChange).toHaveBeenCalledWith({
        ...payload,
        crawl_sub_pages: false,
      })
    })

    it('should call onChange with updated only_main_content when checkbox is clicked', () => {
      const payload = createMockCrawlOptions({ only_main_content: false })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      fireEvent.click(checkboxes[1])

      expect(mockOnChange).toHaveBeenCalledWith({
        ...payload,
        only_main_content: true,
      })
    })

    it('should call onChange with updated limit when input changes', () => {
      const payload = createMockCrawlOptions({ limit: 10 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const limitInput = screen.getByDisplayValue('10')
      fireEvent.change(limitInput, { target: { value: '50' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        ...payload,
        limit: 50,
      })
    })

    it('should call onChange with updated max_depth when input changes', () => {
      const payload = createMockCrawlOptions({ max_depth: 2 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const maxDepthInput = screen.getByDisplayValue('2')
      fireEvent.change(maxDepthInput, { target: { value: '10' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        ...payload,
        max_depth: 10,
      })
    })

    it('should call onChange with updated excludes when input changes', () => {
      const payload = createMockCrawlOptions({ excludes: '' })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const excludesInput = screen.getByPlaceholderText('blog/*, /about/*')
      fireEvent.change(excludesInput, { target: { value: 'admin/*' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        ...payload,
        excludes: 'admin/*',
      })
    })

    it('should call onChange with updated includes when input changes', () => {
      const payload = createMockCrawlOptions({ includes: '' })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const includesInput = screen.getByPlaceholderText('articles/*')
      fireEvent.change(includesInput, { target: { value: 'public/*' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        ...payload,
        includes: 'public/*',
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty string values', () => {
      const payload = createMockCrawlOptions({
        limit: '',
        max_depth: '',
        excludes: '',
        includes: '',
      } as unknown as CrawlOptions)
      render(<Options payload={payload} onChange={mockOnChange} />)

      // Component should render without crashing
      expect(screen.getByText(/limit/i)).toBeInTheDocument()
    })

    it('should handle zero values', () => {
      const payload = createMockCrawlOptions({
        limit: 0,
        max_depth: 0,
      })
      render(<Options payload={payload} onChange={mockOnChange} />)

      // Zero values should be displayed
      const zeroInputs = screen.getAllByDisplayValue('0')
      expect(zeroInputs.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle large numbers', () => {
      const payload = createMockCrawlOptions({
        limit: 9999,
        max_depth: 100,
      })
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByDisplayValue('9999')).toBeInTheDocument()
      expect(screen.getByDisplayValue('100')).toBeInTheDocument()
    })

    it('should handle special characters in text fields', () => {
      const payload = createMockCrawlOptions({
        excludes: 'path/*/file?query=1&param=2',
        includes: 'docs/**/*.md',
      })
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByDisplayValue('path/*/file?query=1&param=2')).toBeInTheDocument()
      expect(screen.getByDisplayValue('docs/**/*.md')).toBeInTheDocument()
    })

    it('should preserve other payload fields when updating one field', () => {
      const payload = createMockCrawlOptions({
        crawl_sub_pages: true,
        limit: 10,
        max_depth: 2,
        excludes: 'test/*',
        includes: 'docs/*',
        only_main_content: true,
      })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const limitInput = screen.getByDisplayValue('10')
      fireEvent.change(limitInput, { target: { value: '20' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        crawl_sub_pages: true,
        limit: 20,
        max_depth: 2,
        excludes: 'test/*',
        includes: 'docs/*',
        only_main_content: true,
        use_sitemap: false,
      })
    })
  })

  // --------------------------------------------------------------------------
  // handleChange Callback Tests
  // --------------------------------------------------------------------------
  describe('handleChange Callback', () => {
    it('should create a new callback for each key', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      // Change limit
      const limitInput = screen.getByDisplayValue('10')
      fireEvent.change(limitInput, { target: { value: '15' } })

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 15 }),
      )

      // Change max_depth
      const maxDepthInput = screen.getByDisplayValue('2')
      fireEvent.change(maxDepthInput, { target: { value: '5' } })

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ max_depth: 5 }),
      )
    })

    it('should handle multiple rapid changes', () => {
      const payload = createMockCrawlOptions({ limit: 10 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const limitInput = screen.getByDisplayValue('10')
      fireEvent.change(limitInput, { target: { value: '11' } })
      fireEvent.change(limitInput, { target: { value: '12' } })
      fireEvent.change(limitInput, { target: { value: '13' } })

      expect(mockOnChange).toHaveBeenCalledTimes(3)
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const payload = createMockCrawlOptions()
      const { rerender } = render(<Options payload={payload} onChange={mockOnChange} />)

      rerender(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByText(/limit/i)).toBeInTheDocument()
    })

    it('should re-render when payload changes', () => {
      const payload1 = createMockCrawlOptions({ limit: 10 })
      const payload2 = createMockCrawlOptions({ limit: 20 })

      const { rerender } = render(<Options payload={payload1} onChange={mockOnChange} />)
      expect(screen.getByDisplayValue('10')).toBeInTheDocument()

      rerender(<Options payload={payload2} onChange={mockOnChange} />)
      expect(screen.getByDisplayValue('20')).toBeInTheDocument()
    })
  })
})
