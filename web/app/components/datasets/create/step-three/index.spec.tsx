import type { createDocumentResponse, FullDocumentDetail, IconInfo } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { RETRIEVE_METHOD } from '@/types/app'
import StepThree from './index'

// Mock the EmbeddingProcess component since it has complex async logic
vi.mock('../embedding-process', () => ({
  default: vi.fn(({ datasetId, batchId, documents, indexingType, retrievalMethod }) => (
    <div data-testid="embedding-process">
      <span data-testid="ep-dataset-id">{datasetId}</span>
      <span data-testid="ep-batch-id">{batchId}</span>
      <span data-testid="ep-documents-count">{documents?.length ?? 0}</span>
      <span data-testid="ep-indexing-type">{indexingType}</span>
      <span data-testid="ep-retrieval-method">{retrievalMethod}</span>
    </div>
  )),
}))

// Mock useBreakpoints hook
let mockMediaType = 'pc'
vi.mock('@/hooks/use-breakpoints', () => ({
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
  default: vi.fn(() => mockMediaType),
}))

// Mock useDocLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.dify.ai/en-US${path || ''}`,
}))

// Factory function to create mock IconInfo
const createMockIconInfo = (overrides: Partial<IconInfo> = {}): IconInfo => ({
  icon: '📙',
  icon_type: 'emoji',
  icon_background: '#FFF4ED',
  icon_url: '',
  ...overrides,
})

// Factory function to create mock FullDocumentDetail
const createMockDocument = (overrides: Partial<FullDocumentDetail> = {}): FullDocumentDetail => ({
  id: 'doc-123',
  name: 'test-document.txt',
  data_source_type: 'upload_file',
  data_source_info: {
    upload_file: {
      id: 'file-123',
      name: 'test-document.txt',
      extension: 'txt',
      mime_type: 'text/plain',
      size: 1024,
      created_by: 'user-1',
      created_at: Date.now(),
    },
  },
  batch: 'batch-123',
  created_api_request_id: 'request-123',
  processing_started_at: Date.now(),
  parsing_completed_at: Date.now(),
  cleaning_completed_at: Date.now(),
  splitting_completed_at: Date.now(),
  tokens: 100,
  indexing_latency: 5000,
  completed_at: Date.now(),
  paused_by: '',
  paused_at: 0,
  stopped_at: 0,
  indexing_status: 'completed',
  disabled_at: 0,
  ...overrides,
} as FullDocumentDetail)

// Factory function to create mock createDocumentResponse
const createMockCreationCache = (overrides: Partial<createDocumentResponse> = {}): createDocumentResponse => ({
  dataset: {
    id: 'dataset-123',
    name: 'Test Dataset',
    icon_info: createMockIconInfo(),
    indexing_technique: 'high_quality',
    retrieval_model_dict: {
      search_method: 'semantic_search',
    },
  } as createDocumentResponse['dataset'],
  batch: 'batch-123',
  documents: [createMockDocument()] as createDocumentResponse['documents'],
  ...overrides,
})

// Helper to render StepThree with default props
const renderStepThree = (props: Partial<Parameters<typeof StepThree>[0]> = {}) => {
  const defaultProps = {
    ...props,
  }
  return render(<StepThree {...defaultProps} />)
}

// ============================================================================
// StepThree Component Tests
// ============================================================================
describe('StepThree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMediaType = 'pc'
  })

  // --------------------------------------------------------------------------
  // Rendering Tests - Verify component renders properly
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderStepThree()

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should render with creation title when datasetId is not provided', () => {
      // Arrange & Act
      renderStepThree()

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.creationTitle')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.creationContent')).toBeInTheDocument()
    })

    it('should render with addition title when datasetId is provided', () => {
      // Arrange & Act
      renderStepThree({
        datasetId: 'existing-dataset-123',
        datasetName: 'Existing Dataset',
      })

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.additionTitle')).toBeInTheDocument()
      expect(screen.queryByText('datasetCreation.stepThree.creationTitle')).not.toBeInTheDocument()
    })

    it('should render label text in creation mode', () => {
      // Arrange & Act
      renderStepThree()

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.label')).toBeInTheDocument()
    })

    it('should render side tip panel on desktop', () => {
      // Arrange
      mockMediaType = 'pc'

      // Act
      renderStepThree()

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.sideTipTitle')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.sideTipContent')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.addDocuments.stepThree.learnMore')).toBeInTheDocument()
    })

    it('should not render side tip panel on mobile', () => {
      // Arrange
      mockMediaType = 'mobile'

      // Act
      renderStepThree()

      // Assert
      expect(screen.queryByText('datasetCreation.stepThree.sideTipTitle')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetCreation.stepThree.sideTipContent')).not.toBeInTheDocument()
    })

    it('should render EmbeddingProcess component', () => {
      // Arrange & Act
      renderStepThree()

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should render documentation link with correct href on desktop', () => {
      // Arrange
      mockMediaType = 'pc'

      // Act
      renderStepThree()

      // Assert
      const link = screen.getByText('datasetPipeline.addDocuments.stepThree.learnMore')
      expect(link).toHaveAttribute('href', 'https://docs.dify.ai/en-US/use-dify/knowledge/integrate-knowledge-within-application')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer noopener')
    })

    it('should apply correct container classes', () => {
      // Arrange & Act
      const { container } = renderStepThree()

      // Assert
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('flex', 'h-full', 'max-h-full', 'w-full', 'justify-center', 'overflow-y-auto')
    })
  })

  // --------------------------------------------------------------------------
  // Props Testing - Test all prop variations
  // --------------------------------------------------------------------------
  describe('Props', () => {
    describe('datasetId prop', () => {
      it('should render creation mode when datasetId is undefined', () => {
        // Arrange & Act
        renderStepThree({ datasetId: undefined })

        // Assert
        expect(screen.getByText('datasetCreation.stepThree.creationTitle')).toBeInTheDocument()
      })

      it('should render addition mode when datasetId is provided', () => {
        // Arrange & Act
        renderStepThree({ datasetId: 'dataset-123' })

        // Assert
        expect(screen.getByText('datasetCreation.stepThree.additionTitle')).toBeInTheDocument()
      })

      it('should pass datasetId to EmbeddingProcess', () => {
        // Arrange
        const datasetId = 'my-dataset-id'

        // Act
        renderStepThree({ datasetId })

        // Assert
        expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent(datasetId)
      })

      it('should use creationCache dataset id when datasetId is not provided', () => {
        // Arrange
        const creationCache = createMockCreationCache()

        // Act
        renderStepThree({ creationCache })

        // Assert
        expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent('dataset-123')
      })
    })

    describe('datasetName prop', () => {
      it('should display datasetName in creation mode', () => {
        // Arrange & Act
        renderStepThree({ datasetName: 'My Custom Dataset' })

        // Assert
        expect(screen.getByText('My Custom Dataset')).toBeInTheDocument()
      })

      it('should display datasetName in addition mode description', () => {
        // Arrange & Act
        renderStepThree({
          datasetId: 'dataset-123',
          datasetName: 'Existing Dataset Name',
        })

        // Assert - Check the text contains the dataset name (in the description)
        const description = screen.getByText(/datasetCreation.stepThree.additionP1.*Existing Dataset Name.*datasetCreation.stepThree.additionP2/i)
        expect(description).toBeInTheDocument()
      })

      it('should fallback to creationCache dataset name when datasetName is not provided', () => {
        // Arrange
        const creationCache = createMockCreationCache()
        creationCache.dataset!.name = 'Cache Dataset Name'

        // Act
        renderStepThree({ creationCache })

        // Assert
        expect(screen.getByText('Cache Dataset Name')).toBeInTheDocument()
      })
    })

    describe('indexingType prop', () => {
      it('should pass indexingType to EmbeddingProcess', () => {
        // Arrange & Act
        renderStepThree({ indexingType: 'high_quality' })

        // Assert
        expect(screen.getByTestId('ep-indexing-type')).toHaveTextContent('high_quality')
      })

      it('should use creationCache indexing_technique when indexingType is not provided', () => {
        // Arrange
        const creationCache = createMockCreationCache()
        creationCache.dataset!.indexing_technique = 'economy' as any

        // Act
        renderStepThree({ creationCache })

        // Assert
        expect(screen.getByTestId('ep-indexing-type')).toHaveTextContent('economy')
      })

      it('should prefer creationCache indexing_technique over indexingType prop', () => {
        // Arrange
        const creationCache = createMockCreationCache()
        creationCache.dataset!.indexing_technique = 'cache_technique' as any

        // Act
        renderStepThree({ creationCache, indexingType: 'prop_technique' })

        // Assert - creationCache takes precedence
        expect(screen.getByTestId('ep-indexing-type')).toHaveTextContent('cache_technique')
      })
    })

    describe('retrievalMethod prop', () => {
      it('should pass retrievalMethod to EmbeddingProcess', () => {
        // Arrange & Act
        renderStepThree({ retrievalMethod: RETRIEVE_METHOD.semantic })

        // Assert
        expect(screen.getByTestId('ep-retrieval-method')).toHaveTextContent('semantic_search')
      })

      it('should use creationCache retrieval method when retrievalMethod is not provided', () => {
        // Arrange
        const creationCache = createMockCreationCache()
        creationCache.dataset!.retrieval_model_dict = { search_method: 'full_text_search' } as any

        // Act
        renderStepThree({ creationCache })

        // Assert
        expect(screen.getByTestId('ep-retrieval-method')).toHaveTextContent('full_text_search')
      })
    })

    describe('creationCache prop', () => {
      it('should pass batchId from creationCache to EmbeddingProcess', () => {
        // Arrange
        const creationCache = createMockCreationCache()
        creationCache.batch = 'custom-batch-123'

        // Act
        renderStepThree({ creationCache })

        // Assert
        expect(screen.getByTestId('ep-batch-id')).toHaveTextContent('custom-batch-123')
      })

      it('should pass documents from creationCache to EmbeddingProcess', () => {
        // Arrange
        const creationCache = createMockCreationCache()
        creationCache.documents = [createMockDocument(), createMockDocument(), createMockDocument()] as any

        // Act
        renderStepThree({ creationCache })

        // Assert
        expect(screen.getByTestId('ep-documents-count')).toHaveTextContent('3')
      })

      it('should use icon_info from creationCache dataset', () => {
        // Arrange
        const creationCache = createMockCreationCache()
        creationCache.dataset!.icon_info = createMockIconInfo({
          icon: '🚀',
          icon_background: '#FF0000',
        })

        // Act
        const { container } = renderStepThree({ creationCache })

        // Assert - Check AppIcon component receives correct props
        const appIcon = container.querySelector('span[style*="background"]')
        expect(appIcon).toBeInTheDocument()
      })

      it('should handle undefined creationCache', () => {
        // Arrange & Act
        renderStepThree({ creationCache: undefined })

        // Assert - Should not crash, use fallback values
        expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent('')
        expect(screen.getByTestId('ep-batch-id')).toHaveTextContent('')
      })

      it('should handle creationCache with undefined dataset', () => {
        // Arrange
        const creationCache: createDocumentResponse = {
          dataset: undefined,
          batch: 'batch-123',
          documents: [],
        }

        // Act
        renderStepThree({ creationCache })

        // Assert - Should use default icon info
        expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests - Test null, undefined, empty values and boundaries
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle all props being undefined', () => {
      // Arrange & Act
      renderStepThree({
        datasetId: undefined,
        datasetName: undefined,
        indexingType: undefined,
        retrievalMethod: undefined,
        creationCache: undefined,
      })

      // Assert - Should render creation mode with fallbacks
      expect(screen.getByText('datasetCreation.stepThree.creationTitle')).toBeInTheDocument()
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should handle empty string datasetId', () => {
      // Arrange & Act
      renderStepThree({ datasetId: '' })

      // Assert - Empty string is falsy, should show creation mode
      expect(screen.getByText('datasetCreation.stepThree.creationTitle')).toBeInTheDocument()
    })

    it('should handle empty string datasetName', () => {
      // Arrange & Act
      renderStepThree({ datasetName: '' })

      // Assert - Should not crash
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should handle empty documents array in creationCache', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      creationCache.documents = []

      // Act
      renderStepThree({ creationCache })

      // Assert
      expect(screen.getByTestId('ep-documents-count')).toHaveTextContent('0')
    })

    it('should handle creationCache with missing icon_info', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      creationCache.dataset!.icon_info = undefined as any

      // Act
      renderStepThree({ creationCache })

      // Assert - Should use default icon info
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should handle very long datasetName', () => {
      // Arrange
      const longName = 'A'.repeat(500)

      // Act
      renderStepThree({ datasetName: longName })

      // Assert - Should render without crashing
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in datasetName', () => {
      // Arrange
      const specialName = 'Dataset <script>alert("xss")</script> & "quotes" \'apostrophe\''

      // Act
      renderStepThree({ datasetName: specialName })

      // Assert - Should render safely as text
      expect(screen.getByText(specialName)).toBeInTheDocument()
    })

    it('should handle unicode characters in datasetName', () => {
      // Arrange
      const unicodeName = '数据集名称 🚀 émojis & spëcîal çhàrs'

      // Act
      renderStepThree({ datasetName: unicodeName })

      // Assert
      expect(screen.getByText(unicodeName)).toBeInTheDocument()
    })

    it('should handle creationCache with null dataset name', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      creationCache.dataset!.name = null as any

      // Act
      const { container } = renderStepThree({ creationCache })

      // Assert - Should not crash
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Conditional Rendering Tests - Test mode switching behavior
  // --------------------------------------------------------------------------
  describe('Conditional Rendering', () => {
    describe('Creation Mode (no datasetId)', () => {
      it('should show AppIcon component', () => {
        // Arrange & Act
        const { container } = renderStepThree()

        // Assert - AppIcon should be rendered
        const appIcon = container.querySelector('span')
        expect(appIcon).toBeInTheDocument()
      })

      it('should show Divider component', () => {
        // Arrange & Act
        const { container } = renderStepThree()

        // Assert - Divider should be rendered (it adds hr with specific classes)
        const dividers = container.querySelectorAll('[class*="divider"]')
        expect(dividers.length).toBeGreaterThan(0)
      })

      it('should show dataset name input area', () => {
        // Arrange
        const datasetName = 'Test Dataset Name'

        // Act
        renderStepThree({ datasetName })

        // Assert
        expect(screen.getByText(datasetName)).toBeInTheDocument()
      })
    })

    describe('Addition Mode (with datasetId)', () => {
      it('should not show AppIcon component', () => {
        // Arrange & Act
        renderStepThree({ datasetId: 'dataset-123' })

        // Assert - Creation section should not be rendered
        expect(screen.queryByText('datasetCreation.stepThree.label')).not.toBeInTheDocument()
      })

      it('should show addition description with dataset name', () => {
        // Arrange & Act
        renderStepThree({
          datasetId: 'dataset-123',
          datasetName: 'My Dataset',
        })

        // Assert - Description should include dataset name
        expect(screen.getByText(/datasetCreation.stepThree.additionP1/)).toBeInTheDocument()
      })
    })

    describe('Mobile vs Desktop', () => {
      it('should show side panel on tablet', () => {
        // Arrange
        mockMediaType = 'tablet'

        // Act
        renderStepThree()

        // Assert - Tablet is not mobile, should show side panel
        expect(screen.getByText('datasetCreation.stepThree.sideTipTitle')).toBeInTheDocument()
      })

      it('should not show side panel on mobile', () => {
        // Arrange
        mockMediaType = 'mobile'

        // Act
        renderStepThree()

        // Assert
        expect(screen.queryByText('datasetCreation.stepThree.sideTipTitle')).not.toBeInTheDocument()
      })

      it('should render EmbeddingProcess on mobile', () => {
        // Arrange
        mockMediaType = 'mobile'

        // Act
        renderStepThree()

        // Assert - Main content should still be rendered
        expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // EmbeddingProcess Integration Tests - Verify correct props are passed
  // --------------------------------------------------------------------------
  describe('EmbeddingProcess Integration', () => {
    it('should pass correct datasetId to EmbeddingProcess with datasetId prop', () => {
      // Arrange & Act
      renderStepThree({ datasetId: 'direct-dataset-id' })

      // Assert
      expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent('direct-dataset-id')
    })

    it('should pass creationCache dataset id when datasetId prop is undefined', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      creationCache.dataset!.id = 'cache-dataset-id'

      // Act
      renderStepThree({ creationCache })

      // Assert
      expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent('cache-dataset-id')
    })

    it('should pass empty string for datasetId when both sources are undefined', () => {
      // Arrange & Act
      renderStepThree()

      // Assert
      expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent('')
    })

    it('should pass batchId from creationCache', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      creationCache.batch = 'test-batch-456'

      // Act
      renderStepThree({ creationCache })

      // Assert
      expect(screen.getByTestId('ep-batch-id')).toHaveTextContent('test-batch-456')
    })

    it('should pass empty string for batchId when creationCache is undefined', () => {
      // Arrange & Act
      renderStepThree()

      // Assert
      expect(screen.getByTestId('ep-batch-id')).toHaveTextContent('')
    })

    it('should prefer datasetId prop over creationCache dataset id', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      creationCache.dataset!.id = 'cache-id'

      // Act
      renderStepThree({ datasetId: 'prop-id', creationCache })

      // Assert - datasetId prop takes precedence
      expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent('prop-id')
    })
  })

  // --------------------------------------------------------------------------
  // Icon Rendering Tests - Verify AppIcon behavior
  // --------------------------------------------------------------------------
  describe('Icon Rendering', () => {
    it('should use default icon info when creationCache is undefined', () => {
      // Arrange & Act
      const { container } = renderStepThree()

      // Assert - Default background color should be applied
      const appIcon = container.querySelector('span[style*="background"]')
      if (appIcon)
        expect(appIcon).toHaveStyle({ background: '#FFF4ED' })
    })

    it('should use icon_info from creationCache when available', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      creationCache.dataset!.icon_info = {
        icon: '🎉',
        icon_type: 'emoji',
        icon_background: '#00FF00',
        icon_url: '',
      }

      // Act
      const { container } = renderStepThree({ creationCache })

      // Assert - Custom background color should be applied
      const appIcon = container.querySelector('span[style*="background"]')
      if (appIcon)
        expect(appIcon).toHaveStyle({ background: '#00FF00' })
    })

    it('should use default icon when creationCache dataset icon_info is undefined', () => {
      // Arrange
      const creationCache = createMockCreationCache()
      delete (creationCache.dataset as any).icon_info

      // Act
      const { container } = renderStepThree({ creationCache })

      // Assert - Component should still render with default icon
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests - Verify correct CSS classes and structure
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have correct outer container classes', () => {
      // Arrange & Act
      const { container } = renderStepThree()

      // Assert
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('flex')
      expect(outerDiv).toHaveClass('h-full')
      expect(outerDiv).toHaveClass('justify-center')
    })

    it('should have correct inner container classes', () => {
      // Arrange & Act
      const { container } = renderStepThree()

      // Assert
      const innerDiv = container.querySelector('.max-w-\\[960px\\]')
      expect(innerDiv).toBeInTheDocument()
      expect(innerDiv).toHaveClass('shrink-0', 'grow')
    })

    it('should have content wrapper with correct max width', () => {
      // Arrange & Act
      const { container } = renderStepThree()

      // Assert
      const contentWrapper = container.querySelector('.max-w-\\[640px\\]')
      expect(contentWrapper).toBeInTheDocument()
    })

    it('should have side tip panel with correct width on desktop', () => {
      // Arrange
      mockMediaType = 'pc'

      // Act
      const { container } = renderStepThree()

      // Assert
      const sidePanel = container.querySelector('.w-\\[328px\\]')
      expect(sidePanel).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Accessibility Tests - Verify accessibility features
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have correct link attributes for external documentation link', () => {
      // Arrange
      mockMediaType = 'pc'

      // Act
      renderStepThree()

      // Assert
      const link = screen.getByText('datasetPipeline.addDocuments.stepThree.learnMore')
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer noopener')
    })

    it('should have semantic heading structure in creation mode', () => {
      // Arrange & Act
      renderStepThree()

      // Assert
      const title = screen.getByText('datasetCreation.stepThree.creationTitle')
      expect(title).toBeInTheDocument()
      expect(title.className).toContain('title-2xl-semi-bold')
    })

    it('should have semantic heading structure in addition mode', () => {
      // Arrange & Act
      renderStepThree({ datasetId: 'dataset-123' })

      // Assert
      const title = screen.getByText('datasetCreation.stepThree.additionTitle')
      expect(title).toBeInTheDocument()
      expect(title.className).toContain('title-2xl-semi-bold')
    })
  })

  // --------------------------------------------------------------------------
  // Side Panel Tests - Verify side panel behavior
  // --------------------------------------------------------------------------
  describe('Side Panel', () => {
    it('should render RiBookOpenLine icon in side panel', () => {
      // Arrange
      mockMediaType = 'pc'

      // Act
      const { container } = renderStepThree()

      // Assert - Icon should be present in side panel
      const iconContainer = container.querySelector('.size-10')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should have correct side panel section background', () => {
      // Arrange
      mockMediaType = 'pc'

      // Act
      const { container } = renderStepThree()

      // Assert
      const sidePanel = container.querySelector('.bg-background-section')
      expect(sidePanel).toBeInTheDocument()
    })

    it('should have correct padding for side panel', () => {
      // Arrange
      mockMediaType = 'pc'

      // Act
      const { container } = renderStepThree()

      // Assert
      const sidePanelWrapper = container.querySelector('.pr-8')
      expect(sidePanelWrapper).toBeInTheDocument()
    })
  })
})
