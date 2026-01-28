import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BuiltInPipelineList from './built-in-pipeline-list'

// Mock child components
vi.mock('./create-card', () => ({
  default: () => <div data-testid="create-card">CreateCard</div>,
}))

vi.mock('./template-card', () => ({
  default: ({ type, pipeline, showMoreOperations }: { type: string, pipeline: { name: string }, showMoreOperations?: boolean }) => (
    <div data-testid="template-card" data-type={type} data-show-more={String(showMoreOperations)}>
      {pipeline.name}
    </div>
  ),
}))

// Configurable locale mock
let mockLocale = 'en-US'

// Mock hooks
vi.mock('@/context/i18n', () => ({
  useLocale: () => mockLocale,
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn((selector) => {
    const state = { systemFeatures: { enable_marketplace: true } }
    return selector(state)
  }),
}))

const mockUsePipelineTemplateList = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateList: (...args: unknown[]) => mockUsePipelineTemplateList(...args),
}))

// ============================================================================
// BuiltInPipelineList Component Tests
// ============================================================================

describe('BuiltInPipelineList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale = 'en-US'
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)
      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should always render CreateCard', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<BuiltInPipelineList />)
      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should not render TemplateCards when loading', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: {
          pipeline_templates: [{ name: 'Pipeline 1' }],
        },
        isLoading: true,
      })

      render(<BuiltInPipelineList />)
      expect(screen.queryByTestId('template-card')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Rendering with Data Tests
  // --------------------------------------------------------------------------
  describe('Rendering with Data', () => {
    it('should render TemplateCard for each pipeline when not loading', () => {
      const mockPipelines = [
        { name: 'Pipeline 1' },
        { name: 'Pipeline 2' },
      ]
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: mockPipelines },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)
      const cards = screen.getAllByTestId('template-card')
      expect(cards).toHaveLength(2)
    })

    it('should pass correct props to TemplateCard', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: {
          pipeline_templates: [{ name: 'Test Pipeline' }],
        },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)
      const card = screen.getByTestId('template-card')
      expect(card).toHaveAttribute('data-type', 'built-in')
      expect(card).toHaveAttribute('data-show-more', 'false')
    })

    it('should render CreateCard as first element', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: {
          pipeline_templates: [{ name: 'Pipeline 1' }],
        },
        isLoading: false,
      })

      const { container } = render(<BuiltInPipelineList />)
      const grid = container.querySelector('.grid')
      const firstChild = grid?.firstChild as HTMLElement
      expect(firstChild).toHaveAttribute('data-testid', 'create-card')
    })
  })

  // --------------------------------------------------------------------------
  // API Call Tests
  // --------------------------------------------------------------------------
  describe('API Call', () => {
    it('should call usePipelineTemplateList with type built-in', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<BuiltInPipelineList />)
      expect(mockUsePipelineTemplateList).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'built-in' }),
        expect.any(Boolean),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have grid layout', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      const { container } = render(<BuiltInPipelineList />)
      const grid = container.querySelector('.grid')
      expect(grid).toHaveClass('grid-cols-1', 'gap-3', 'py-2')
    })

    it('should have responsive grid columns', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      const { container } = render(<BuiltInPipelineList />)
      const grid = container.querySelector('.grid')
      expect(grid).toHaveClass('sm:grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-4')
    })
  })

  // --------------------------------------------------------------------------
  // Locale Handling Tests (Branch Coverage)
  // --------------------------------------------------------------------------
  describe('Locale Handling', () => {
    it('should use zh-Hans locale when set', () => {
      mockLocale = 'zh-Hans'
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)

      expect(mockUsePipelineTemplateList).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'zh-Hans' }),
        expect.any(Boolean),
      )
    })

    it('should use ja-JP locale when set', () => {
      mockLocale = 'ja-JP'
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)

      expect(mockUsePipelineTemplateList).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'ja-JP' }),
        expect.any(Boolean),
      )
    })

    it('should fallback to default language for unsupported locales', () => {
      mockLocale = 'fr-FR'
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)

      // Should fall back to LanguagesSupported[0] which is 'en-US'
      expect(mockUsePipelineTemplateList).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'en-US' }),
        expect.any(Boolean),
      )
    })

    it('should fallback to default language for en-US locale', () => {
      mockLocale = 'en-US'
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)

      expect(mockUsePipelineTemplateList).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'en-US' }),
        expect.any(Boolean),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Empty Data Tests
  // --------------------------------------------------------------------------
  describe('Empty Data', () => {
    it('should handle null pipeline_templates', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: null },
        isLoading: false,
      })

      render(<BuiltInPipelineList />)
      expect(screen.getByTestId('create-card')).toBeInTheDocument()
      expect(screen.queryByTestId('template-card')).not.toBeInTheDocument()
    })

    it('should handle undefined data', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: undefined,
        isLoading: false,
      })

      render(<BuiltInPipelineList />)
      expect(screen.getByTestId('create-card')).toBeInTheDocument()
      expect(screen.queryByTestId('template-card')).not.toBeInTheDocument()
    })
  })
})
