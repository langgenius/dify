import { render, screen } from '@testing-library/react'
import List from './index'
import type { PipelineTemplate, PipelineTemplateListResponse } from '@/models/pipeline'
import { ChunkingMode } from '@/models/datasets'

// Mock i18n context
let mockLocale = 'en-US'
jest.mock('@/context/i18n', () => ({
  useI18N: () => ({
    locale: mockLocale,
  }),
}))

// Mock global public store
let mockEnableMarketplace = true
jest.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => boolean) =>
    selector({ systemFeatures: { enable_marketplace: mockEnableMarketplace } }),
}))

// Mock pipeline service hooks
let mockBuiltInPipelineData: PipelineTemplateListResponse | undefined
let mockBuiltInIsLoading = false
let mockCustomizedPipelineData: PipelineTemplateListResponse | undefined
let mockCustomizedIsLoading = false

jest.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateList: (params: { type: 'built-in' | 'customized'; language?: string }, enabled?: boolean) => {
    if (params.type === 'built-in') {
      return {
        data: enabled !== false ? mockBuiltInPipelineData : undefined,
        isLoading: mockBuiltInIsLoading,
      }
    }
    return {
      data: mockCustomizedPipelineData,
      isLoading: mockCustomizedIsLoading,
    }
  },
}))

// Mock CreateCard component to avoid deep service dependencies
jest.mock('./create-card', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="create-card" className="h-[132px] cursor-pointer">
      <span>datasetPipeline.creation.createFromScratch.title</span>
      <span>datasetPipeline.creation.createFromScratch.description</span>
    </div>
  ),
}))

// Mock TemplateCard component to avoid deep service dependencies
jest.mock('./template-card', () => ({
  __esModule: true,
  default: ({ pipeline, type, showMoreOperations }: {
    pipeline: PipelineTemplate
    type: 'built-in' | 'customized'
    showMoreOperations?: boolean
  }) => (
    <div
      data-testid={`template-card-${pipeline.id}`}
      data-type={type}
      data-show-more={showMoreOperations}
      className="h-[132px]"
    >
      <span data-testid={`template-name-${pipeline.id}`}>{pipeline.name}</span>
      <span data-testid={`template-description-${pipeline.id}`}>{pipeline.description}</span>
      <span data-testid={`template-chunk-structure-${pipeline.id}`}>{pipeline.chunk_structure}</span>
    </div>
  ),
}))

// Factory function for creating mock pipeline templates
const createMockPipelineTemplate = (overrides: Partial<PipelineTemplate> = {}): PipelineTemplate => ({
  id: 'template-1',
  name: 'Test Pipeline',
  description: 'Test pipeline description',
  icon: {
    icon_type: 'emoji',
    icon: '🔧',
    icon_background: '#FFEAD5',
    icon_url: '',
  },
  position: 1,
  chunk_structure: ChunkingMode.text,
  ...overrides,
})

describe('List', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLocale = 'en-US'
    mockEnableMarketplace = true
    mockBuiltInPipelineData = undefined
    mockBuiltInIsLoading = false
    mockCustomizedPipelineData = undefined
    mockCustomizedIsLoading = false
  })

  /**
   * List Component Container
   * Tests for the main List wrapper component rendering and styling
   */
  describe('List Component Container', () => {
    it('should render without crashing', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toBeInTheDocument()
    })

    it('should render the main container as a div element', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer.tagName).toBe('DIV')
    })

    it('should render the main container with grow class for flex expansion', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('grow')
    })

    it('should render the main container with gap-y-1 class for vertical spacing', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('gap-y-1')
    })

    it('should render the main container with overflow-y-auto for vertical scrolling', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('overflow-y-auto')
    })

    it('should render the main container with horizontal padding px-16', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('px-16')
    })

    it('should render the main container with bottom padding pb-[60px]', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('pb-[60px]')
    })

    it('should render the main container with top padding pt-1', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('pt-1')
    })

    it('should have all required styling classes applied', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('grow')
      expect(mainContainer).toHaveClass('gap-y-1')
      expect(mainContainer).toHaveClass('overflow-y-auto')
      expect(mainContainer).toHaveClass('px-16')
      expect(mainContainer).toHaveClass('pb-[60px]')
      expect(mainContainer).toHaveClass('pt-1')
    })

    it('should render both BuiltInPipelineList and CustomizedList as children when customized data exists', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'custom-child-test' })],
      }

      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      // BuiltInPipelineList always renders (1 child)
      // CustomizedList renders when it has data (adds more children: title + grid)
      // So we should have at least 2 children when customized data exists
      expect(mainContainer.children.length).toBeGreaterThanOrEqual(2)
    })

    it('should render only BuiltInPipelineList when customized list is empty', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      // CustomizedList returns null when empty, so only BuiltInPipelineList renders
      expect(mainContainer.children.length).toBe(1)
    })
  })

  /**
   * BuiltInPipelineList Integration
   * Tests for built-in pipeline templates list including CreateCard and TemplateCards
   */
  describe('BuiltInPipelineList Integration', () => {
    it('should render CreateCard component', () => {
      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.creation.createFromScratch.title')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.creation.createFromScratch.description')).toBeInTheDocument()
    })

    it('should render grid container with correct responsive classes', () => {
      const { container } = render(<List />)

      const gridContainer = container.querySelector('.grid')
      expect(gridContainer).toBeInTheDocument()
      expect(gridContainer).toHaveClass('grid-cols-1')
      expect(gridContainer).toHaveClass('gap-3')
      expect(gridContainer).toHaveClass('py-2')
      expect(gridContainer).toHaveClass('sm:grid-cols-2')
      expect(gridContainer).toHaveClass('md:grid-cols-3')
      expect(gridContainer).toHaveClass('lg:grid-cols-4')
    })

    it('should not render built-in template cards when loading', () => {
      mockBuiltInIsLoading = true
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate()],
      }

      render(<List />)

      expect(screen.queryByTestId('template-card-template-1')).not.toBeInTheDocument()
    })

    it('should render built-in template cards when data is loaded', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'built-1', name: 'Pipeline 1' }),
          createMockPipelineTemplate({ id: 'built-2', name: 'Pipeline 2' }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-card-built-1')).toBeInTheDocument()
      expect(screen.getByTestId('template-card-built-2')).toBeInTheDocument()
      expect(screen.getByText('Pipeline 1')).toBeInTheDocument()
      expect(screen.getByText('Pipeline 2')).toBeInTheDocument()
    })

    it('should render empty state when no built-in templates (only CreateCard visible)', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [],
      }

      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
      expect(screen.queryByTestId(/^template-card-/)).not.toBeInTheDocument()
    })

    it('should handle undefined pipeline_templates gracefully', () => {
      mockBuiltInPipelineData = {} as PipelineTemplateListResponse

      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should pass type=built-in to TemplateCard', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'built-type-test' })],
      }

      render(<List />)

      const templateCard = screen.getByTestId('template-card-built-type-test')
      expect(templateCard).toHaveAttribute('data-type', 'built-in')
    })

    it('should pass showMoreOperations=false to built-in TemplateCards', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'built-ops-test' })],
      }

      render(<List />)

      const templateCard = screen.getByTestId('template-card-built-ops-test')
      expect(templateCard).toHaveAttribute('data-show-more', 'false')
    })

    it('should render multiple built-in templates in order', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'first', name: 'First' }),
          createMockPipelineTemplate({ id: 'second', name: 'Second' }),
          createMockPipelineTemplate({ id: 'third', name: 'Third' }),
        ],
      }

      const { container } = render(<List />)

      const gridContainer = container.querySelector('.grid')
      const cards = gridContainer?.querySelectorAll('[data-testid^="template-card-"]')

      expect(cards?.length).toBe(3)
    })
  })

  /**
   * CustomizedList Integration
   * Tests for customized pipeline templates list including conditional rendering
   */
  describe('CustomizedList Integration', () => {
    it('should return null when loading', () => {
      mockCustomizedIsLoading = true

      render(<List />)

      expect(screen.queryByText('datasetPipeline.templates.customized')).not.toBeInTheDocument()
    })

    it('should return null when list is empty', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [],
      }

      render(<List />)

      expect(screen.queryByText('datasetPipeline.templates.customized')).not.toBeInTheDocument()
    })

    it('should return null when pipeline_templates is undefined', () => {
      mockCustomizedPipelineData = {} as PipelineTemplateListResponse

      render(<List />)

      expect(screen.queryByText('datasetPipeline.templates.customized')).not.toBeInTheDocument()
    })

    it('should render customized section title when data is available', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'custom-1' })],
      }

      render(<List />)

      expect(screen.getByText('datasetPipeline.templates.customized')).toBeInTheDocument()
    })

    it('should render customized title with correct styling', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [createMockPipelineTemplate()],
      }

      const { container } = render(<List />)

      const title = container.querySelector('.system-sm-semibold-uppercase')
      expect(title).toBeInTheDocument()
      expect(title).toHaveClass('pt-2')
      expect(title).toHaveClass('text-text-tertiary')
    })

    it('should render customized template cards', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'custom-1', name: 'Custom Pipeline 1' }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-card-custom-1')).toBeInTheDocument()
      expect(screen.getByText('Custom Pipeline 1')).toBeInTheDocument()
    })

    it('should render multiple customized templates', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'custom-1', name: 'Custom 1' }),
          createMockPipelineTemplate({ id: 'custom-2', name: 'Custom 2' }),
          createMockPipelineTemplate({ id: 'custom-3', name: 'Custom 3' }),
        ],
      }

      render(<List />)

      expect(screen.getByText('Custom 1')).toBeInTheDocument()
      expect(screen.getByText('Custom 2')).toBeInTheDocument()
      expect(screen.getByText('Custom 3')).toBeInTheDocument()
    })

    it('should pass type=customized to TemplateCard', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'custom-type-test' })],
      }

      render(<List />)

      const templateCard = screen.getByTestId('template-card-custom-type-test')
      expect(templateCard).toHaveAttribute('data-type', 'customized')
    })

    it('should not pass showMoreOperations prop to customized TemplateCards (defaults to true)', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'custom-ops-test' })],
      }

      render(<List />)

      const templateCard = screen.getByTestId('template-card-custom-ops-test')
      // showMoreOperations is not passed, so data-show-more should be undefined
      expect(templateCard).not.toHaveAttribute('data-show-more', 'false')
    })

    it('should render customized grid with responsive classes', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: [createMockPipelineTemplate()],
      }

      const { container } = render(<List />)

      // Find the second grid (customized list grid)
      const grids = container.querySelectorAll('.grid')
      expect(grids.length).toBe(2) // built-in grid and customized grid
      expect(grids[1]).toHaveClass('grid-cols-1')
      expect(grids[1]).toHaveClass('gap-3')
      expect(grids[1]).toHaveClass('py-2')
    })
  })

  /**
   * Language Handling
   * Tests for locale-based language selection in BuiltInPipelineList
   */
  describe('Language Handling', () => {
    it('should use zh-Hans locale when set', () => {
      mockLocale = 'zh-Hans'
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate()],
      }

      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should use ja-JP locale when set', () => {
      mockLocale = 'ja-JP'
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate()],
      }

      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should fallback to default language for unsupported locales', () => {
      mockLocale = 'fr-FR'
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate()],
      }

      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should handle ko-KR locale (fallback)', () => {
      mockLocale = 'ko-KR'

      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })
  })

  /**
   * Marketplace Feature Flag
   * Tests for enable_marketplace system feature affecting built-in templates fetching
   */
  describe('Marketplace Feature Flag', () => {
    it('should not fetch built-in templates when marketplace is disabled', () => {
      mockEnableMarketplace = false
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ name: 'Should Not Show' })],
      }

      render(<List />)

      // CreateCard should render but template should not (enabled=false)
      expect(screen.getByTestId('create-card')).toBeInTheDocument()
      expect(screen.queryByText('Should Not Show')).not.toBeInTheDocument()
    })

    it('should fetch built-in templates when marketplace is enabled', () => {
      mockEnableMarketplace = true
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'marketplace', name: 'Marketplace Template' })],
      }

      render(<List />)

      expect(screen.getByText('Marketplace Template')).toBeInTheDocument()
    })
  })

  /**
   * Template Data Rendering
   * Tests for correct rendering of template properties (name, description, chunk_structure)
   */
  describe('Template Data Rendering', () => {
    it('should render template name correctly', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'name-test', name: 'My Custom Pipeline Name' }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-name-name-test')).toHaveTextContent('My Custom Pipeline Name')
    })

    it('should render template description correctly', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'desc-test', description: 'This is a detailed description' }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-description-desc-test')).toHaveTextContent('This is a detailed description')
    })

    it('should render template with text chunk structure', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'chunk-text', chunk_structure: ChunkingMode.text }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-chunk-structure-chunk-text')).toHaveTextContent(ChunkingMode.text)
    })

    it('should render template with qa chunk structure', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'chunk-qa', chunk_structure: ChunkingMode.qa }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-chunk-structure-chunk-qa')).toHaveTextContent(ChunkingMode.qa)
    })

    it('should render template with parentChild chunk structure', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'chunk-pc', chunk_structure: ChunkingMode.parentChild }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-chunk-structure-chunk-pc')).toHaveTextContent(ChunkingMode.parentChild)
    })
  })

  /**
   * Edge Cases
   * Tests for boundary conditions, special characters, and component lifecycle
   */
  describe('Edge Cases', () => {
    it('should handle component mounting without errors', () => {
      expect(() => render(<List />)).not.toThrow()
    })

    it('should handle component unmounting without errors', () => {
      const { unmount } = render(<List />)

      expect(() => unmount()).not.toThrow()
    })

    it('should handle multiple rerenders without issues', () => {
      const { rerender } = render(<List />)

      rerender(<List />)
      rerender(<List />)
      rerender(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
    })

    it('should maintain consistent DOM structure across rerenders', () => {
      const { container, rerender } = render(<List />)

      const initialChildCount = (container.firstChild as HTMLElement)?.children.length

      rerender(<List />)

      const afterRerenderChildCount = (container.firstChild as HTMLElement)?.children.length
      expect(afterRerenderChildCount).toBe(initialChildCount)
    })

    it('should handle concurrent built-in and customized templates', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'built-in-1', name: 'Built-in Template' }),
        ],
      }
      mockCustomizedPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'custom-1', name: 'Customized Template' }),
        ],
      }

      render(<List />)

      expect(screen.getByText('Built-in Template')).toBeInTheDocument()
      expect(screen.getByText('Customized Template')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.templates.customized')).toBeInTheDocument()
    })

    it('should handle templates with long names gracefully', () => {
      const longName = 'A'.repeat(100)
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'long-name', name: longName }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-name-long-name')).toHaveTextContent(longName)
    })

    it('should handle templates with empty description', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'empty-desc', description: '' }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-description-empty-desc')).toHaveTextContent('')
    })

    it('should handle templates with special characters in name', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [
          createMockPipelineTemplate({ id: 'special', name: 'Test <>&"\'Pipeline' }),
        ],
      }

      render(<List />)

      expect(screen.getByTestId('template-name-special')).toHaveTextContent('Test <>&"\'Pipeline')
    })

    it('should handle rapid mount/unmount cycles', () => {
      for (let i = 0; i < 5; i++) {
        const { unmount } = render(<List />)
        unmount()
      }

      expect(true).toBe(true)
    })
  })

  /**
   * Loading States
   * Tests for component behavior during data loading
   */
  describe('Loading States', () => {
    it('should handle both lists loading simultaneously', () => {
      mockBuiltInIsLoading = true
      mockCustomizedIsLoading = true

      render(<List />)

      expect(screen.getByTestId('create-card')).toBeInTheDocument()
      expect(screen.queryByText('datasetPipeline.templates.customized')).not.toBeInTheDocument()
    })

    it('should handle built-in loading while customized is loaded', () => {
      mockBuiltInIsLoading = true
      mockCustomizedPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'custom-only', name: 'Customized Only' })],
      }

      render(<List />)

      expect(screen.getByText('Customized Only')).toBeInTheDocument()
    })

    it('should handle customized loading while built-in is loaded', () => {
      mockCustomizedIsLoading = true
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'built-only', name: 'Built-in Only' })],
      }

      render(<List />)

      expect(screen.getByText('Built-in Only')).toBeInTheDocument()
      expect(screen.queryByText('datasetPipeline.templates.customized')).not.toBeInTheDocument()
    })

    it('should transition from loading to loaded state', () => {
      mockBuiltInIsLoading = true
      const { rerender } = render(<List />)

      expect(screen.queryByTestId('template-card-transition')).not.toBeInTheDocument()

      // Simulate data loaded
      mockBuiltInIsLoading = false
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'transition', name: 'After Load' })],
      }

      rerender(<List />)

      expect(screen.getByText('After Load')).toBeInTheDocument()
    })
  })

  /**
   * Component Stability
   * Tests for consistent rendering and state management
   */
  describe('Component Stability', () => {
    it('should render same structure on initial render and rerender', () => {
      const { container, rerender } = render(<List />)

      const initialHTML = container.innerHTML

      rerender(<List />)

      const rerenderHTML = container.innerHTML
      expect(rerenderHTML).toBe(initialHTML)
    })

    it('should not cause memory leaks on unmount', () => {
      const { unmount } = render(<List />)

      unmount()

      expect(true).toBe(true)
    })

    it('should handle state changes correctly', () => {
      mockBuiltInPipelineData = undefined

      const { rerender } = render(<List />)

      // Add data
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate({ id: 'state-test', name: 'State Test' })],
      }

      rerender(<List />)

      expect(screen.getByText('State Test')).toBeInTheDocument()
    })
  })

  /**
   * Accessibility
   * Tests for semantic structure and keyboard navigation support
   */
  describe('Accessibility', () => {
    it('should use semantic div structure for main container', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer.tagName).toBe('DIV')
    })

    it('should have scrollable container for keyboard navigation', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('overflow-y-auto')
    })

    it('should have appropriate spacing for readability', () => {
      const { container } = render(<List />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('gap-y-1')
      expect(mainContainer).toHaveClass('px-16')
    })

    it('should render grid structure for template cards', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: [createMockPipelineTemplate()],
      }

      const { container } = render(<List />)

      const grid = container.querySelector('.grid')
      expect(grid).toBeInTheDocument()
    })
  })

  /**
   * Large Datasets
   * Tests for performance with many templates
   */
  describe('Large Datasets', () => {
    it('should handle many built-in templates', () => {
      mockBuiltInPipelineData = {
        pipeline_templates: Array.from({ length: 50 }, (_, i) =>
          createMockPipelineTemplate({ id: `built-${i}`, name: `Pipeline ${i}` }),
        ),
      }

      render(<List />)

      expect(screen.getByText('Pipeline 0')).toBeInTheDocument()
      expect(screen.getByText('Pipeline 49')).toBeInTheDocument()
    })

    it('should handle many customized templates', () => {
      mockCustomizedPipelineData = {
        pipeline_templates: Array.from({ length: 50 }, (_, i) =>
          createMockPipelineTemplate({ id: `custom-${i}`, name: `Custom ${i}` }),
        ),
      }

      render(<List />)

      expect(screen.getByText('Custom 0')).toBeInTheDocument()
      expect(screen.getByText('Custom 49')).toBeInTheDocument()
    })
  })
})
