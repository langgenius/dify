import type { CrawlOptions } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Options from '../options'

// Test Data Factory

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

// WaterCrawl Options Component Tests

describe('Options (watercrawl)', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getCheckboxes = (container: HTMLElement) => {
    return container.querySelectorAll('[data-testid^="checkbox-"]')
  }

  describe('Rendering', () => {
    it('should render all form fields', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByText(/crawlSubPage/i)).toBeInTheDocument()
      expect(screen.getByText(/extractOnlyMainContent/i)).toBeInTheDocument()
      expect(screen.getByText(/limit/i)).toBeInTheDocument()
      expect(screen.getByText(/maxDepth/i)).toBeInTheDocument()
      expect(screen.getByText(/excludePaths/i)).toBeInTheDocument()
      expect(screen.getByText(/includeOnlyPaths/i)).toBeInTheDocument()
    })

    it('should render two checkboxes', () => {
      const payload = createMockCrawlOptions()
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      expect(checkboxes.length).toBe(2)
    })

    it('should render limit field with required indicator', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      const requiredIndicator = screen.getByText('*')
      expect(requiredIndicator).toBeInTheDocument()
    })

    it('should render placeholder for excludes field', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByPlaceholderText('blog/*, /about/*')).toBeInTheDocument()
    })

    it('should render placeholder for includes field', () => {
      const payload = createMockCrawlOptions()
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByPlaceholderText('articles/*')).toBeInTheDocument()
    })

    it('should render with custom className', () => {
      const payload = createMockCrawlOptions()
      const { container } = render(
        <Options payload={payload} onChange={mockOnChange} className="custom-class" />,
      )

      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveClass('custom-class')
    })
  })

  // Props Display Tests
  describe('Props Display', () => {
    it('should display crawl_sub_pages checkbox with check icon when true', () => {
      const payload = createMockCrawlOptions({ crawl_sub_pages: true })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      expect(checkboxes[0].querySelector('svg')).toBeInTheDocument()
    })

    it('should display crawl_sub_pages checkbox without check icon when false', () => {
      const payload = createMockCrawlOptions({ crawl_sub_pages: false })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      expect(checkboxes[0].querySelector('svg')).not.toBeInTheDocument()
    })

    it('should display only_main_content checkbox with check icon when true', () => {
      const payload = createMockCrawlOptions({ only_main_content: true })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      expect(checkboxes[1].querySelector('svg')).toBeInTheDocument()
    })

    it('should display only_main_content checkbox without check icon when false', () => {
      const payload = createMockCrawlOptions({ only_main_content: false })
      const { container } = render(<Options payload={payload} onChange={mockOnChange} />)

      const checkboxes = getCheckboxes(container)
      expect(checkboxes[1].querySelector('svg')).not.toBeInTheDocument()
    })

    it('should display limit value in input', () => {
      const payload = createMockCrawlOptions({ limit: 25 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByDisplayValue('25')).toBeInTheDocument()
    })

    it('should display max_depth value in input', () => {
      const payload = createMockCrawlOptions({ max_depth: 5 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    })

    it('should display excludes value in input', () => {
      const payload = createMockCrawlOptions({ excludes: 'test/*' })
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByDisplayValue('test/*')).toBeInTheDocument()
    })

    it('should display includes value in input', () => {
      const payload = createMockCrawlOptions({ includes: 'docs/*' })
      render(<Options payload={payload} onChange={mockOnChange} />)

      expect(screen.getByDisplayValue('docs/*')).toBeInTheDocument()
    })
  })

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

  describe('Edge Cases', () => {
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

    it('should handle zero values', () => {
      const payload = createMockCrawlOptions({ limit: 0, max_depth: 0 })
      render(<Options payload={payload} onChange={mockOnChange} />)

      const zeroInputs = screen.getAllByDisplayValue('0')
      expect(zeroInputs.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Memoization', () => {
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
