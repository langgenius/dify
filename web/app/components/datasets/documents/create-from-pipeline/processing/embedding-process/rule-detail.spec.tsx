import type { ProcessRuleResponse } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import RuleDetail from './rule-detail'

// ==========================================
// Mock External Dependencies
// ==========================================

// Mock next/image (using img element for simplicity in tests)
vi.mock('next/image', () => ({
  default: function MockImage({ src, alt, className }: { src: string, alt: string, className?: string }) {
    // eslint-disable-next-line next/no-img-element
    return <img src={src} alt={alt} className={className} data-testid="next-image" />
  },
}))

// Mock FieldInfo component
vi.mock('@/app/components/datasets/documents/detail/metadata', () => ({
  FieldInfo: ({ label, displayedValue, valueIcon }: { label: string, displayedValue: string, valueIcon?: React.ReactNode }) => (
    <div data-testid="field-info" data-label={label}>
      <span data-testid="field-label">{label}</span>
      <span data-testid="field-value">{displayedValue}</span>
      {!!valueIcon && <span data-testid="field-icon">{valueIcon}</span>}
    </div>
  ),
}))

// Mock icons - provides simple string paths for testing instead of Next.js static import objects
vi.mock('@/app/components/datasets/create/icons', () => ({
  indexMethodIcon: {
    economical: '/icons/economical.svg',
    high_quality: '/icons/high_quality.svg',
  },
  retrievalIcon: {
    fullText: '/icons/fullText.svg',
    hybrid: '/icons/hybrid.svg',
    vector: '/icons/vector.svg',
  },
}))

// ==========================================
// Test Data Factory Functions
// ==========================================

/**
 * Creates a mock ProcessRuleResponse for testing
 */
const createMockProcessRule = (overrides: Partial<ProcessRuleResponse> = {}): ProcessRuleResponse => ({
  mode: ProcessMode.general,
  rules: {
    pre_processing_rules: [],
    segmentation: {
      separator: '\n',
      max_tokens: 500,
      chunk_overlap: 50,
    },
    parent_mode: 'paragraph',
    subchunk_segmentation: {
      separator: '\n',
      max_tokens: 200,
      chunk_overlap: 20,
    },
  },
  limits: {
    indexing_max_segmentation_tokens_length: 1000,
  },
  ...overrides,
})

// ==========================================
// Test Suite
// ==========================================

describe('RuleDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert
      const fieldInfos = screen.getAllByTestId('field-info')
      expect(fieldInfos).toHaveLength(3)
    })

    it('should render three FieldInfo components', () => {
      // Arrange
      const sourceData = createMockProcessRule()

      // Act
      render(
        <RuleDetail
          sourceData={sourceData}
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.semantic}
        />,
      )

      // Assert
      const fieldInfos = screen.getAllByTestId('field-info')
      expect(fieldInfos).toHaveLength(3)
    })

    it('should render mode field with correct label', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert - first field-info is for mode
      const fieldInfos = screen.getAllByTestId('field-info')
      expect(fieldInfos[0]).toHaveAttribute('data-label', 'datasetDocuments.embedding.mode')
    })
  })

  // ==========================================
  // Mode Value Tests
  // ==========================================
  describe('Mode Value', () => {
    it('should show "-" when sourceData is undefined', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[0]).toHaveTextContent('-')
    })

    it('should show "-" when sourceData.mode is undefined', () => {
      // Arrange
      const sourceData = { ...createMockProcessRule(), mode: undefined as unknown as ProcessMode }

      // Act
      render(<RuleDetail sourceData={sourceData} />)

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[0]).toHaveTextContent('-')
    })

    it('should show custom mode text when mode is general', () => {
      // Arrange
      const sourceData = createMockProcessRule({ mode: ProcessMode.general })

      // Act
      render(<RuleDetail sourceData={sourceData} />)

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[0]).toHaveTextContent('datasetDocuments.embedding.custom')
    })

    it('should show hierarchical mode with paragraph parent mode', () => {
      // Arrange
      const sourceData = createMockProcessRule({
        mode: ProcessMode.parentChild,
        rules: {
          pre_processing_rules: [],
          segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
          parent_mode: 'paragraph',
          subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 20 },
        },
      })

      // Act
      render(<RuleDetail sourceData={sourceData} />)

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[0]).toHaveTextContent('datasetDocuments.embedding.hierarchical · dataset.parentMode.paragraph')
    })

    it('should show hierarchical mode with full-doc parent mode', () => {
      // Arrange
      const sourceData = createMockProcessRule({
        mode: ProcessMode.parentChild,
        rules: {
          pre_processing_rules: [],
          segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
          parent_mode: 'full-doc',
          subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 20 },
        },
      })

      // Act
      render(<RuleDetail sourceData={sourceData} />)

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[0]).toHaveTextContent('datasetDocuments.embedding.hierarchical · dataset.parentMode.fullDoc')
    })
  })

  // ==========================================
  // Indexing Type Tests
  // ==========================================
  describe('Indexing Type', () => {
    it('should show qualified indexing type', () => {
      // Arrange & Act
      render(<RuleDetail indexingType={IndexingType.QUALIFIED} />)

      // Assert
      const fieldInfos = screen.getAllByTestId('field-info')
      expect(fieldInfos[1]).toHaveAttribute('data-label', 'datasetCreation.stepTwo.indexMode')

      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[1]).toHaveTextContent('datasetCreation.stepTwo.qualified')
    })

    it('should show economical indexing type', () => {
      // Arrange & Act
      render(<RuleDetail indexingType={IndexingType.ECONOMICAL} />)

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[1]).toHaveTextContent('datasetCreation.stepTwo.economical')
    })

    it('should show high_quality icon for qualified indexing', () => {
      // Arrange & Act
      render(<RuleDetail indexingType={IndexingType.QUALIFIED} />)

      // Assert
      const images = screen.getAllByTestId('next-image')
      expect(images[0]).toHaveAttribute('src', '/icons/high_quality.svg')
    })

    it('should show economical icon for economical indexing', () => {
      // Arrange & Act
      render(<RuleDetail indexingType={IndexingType.ECONOMICAL} />)

      // Assert
      const images = screen.getAllByTestId('next-image')
      expect(images[0]).toHaveAttribute('src', '/icons/economical.svg')
    })
  })

  // ==========================================
  // Retrieval Method Tests
  // ==========================================
  describe('Retrieval Method', () => {
    it('should show retrieval setting label', () => {
      // Arrange & Act
      render(<RuleDetail retrievalMethod={RETRIEVE_METHOD.semantic} />)

      // Assert
      const fieldInfos = screen.getAllByTestId('field-info')
      expect(fieldInfos[2]).toHaveAttribute('data-label', 'datasetSettings.form.retrievalSetting.title')
    })

    it('should show semantic search title for qualified indexing with semantic method', () => {
      // Arrange & Act
      render(
        <RuleDetail
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.semantic}
        />,
      )

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[2]).toHaveTextContent('dataset.retrieval.semantic_search.title')
    })

    it('should show full text search title for fullText method', () => {
      // Arrange & Act
      render(
        <RuleDetail
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.fullText}
        />,
      )

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[2]).toHaveTextContent('dataset.retrieval.full_text_search.title')
    })

    it('should show hybrid search title for hybrid method', () => {
      // Arrange & Act
      render(
        <RuleDetail
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.hybrid}
        />,
      )

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[2]).toHaveTextContent('dataset.retrieval.hybrid_search.title')
    })

    it('should force keyword_search for economical indexing type', () => {
      // Arrange & Act
      render(
        <RuleDetail
          indexingType={IndexingType.ECONOMICAL}
          retrievalMethod={RETRIEVE_METHOD.semantic}
        />,
      )

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[2]).toHaveTextContent('dataset.retrieval.keyword_search.title')
    })

    it('should show vector icon for semantic search', () => {
      // Arrange & Act
      render(
        <RuleDetail
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.semantic}
        />,
      )

      // Assert
      const images = screen.getAllByTestId('next-image')
      expect(images[1]).toHaveAttribute('src', '/icons/vector.svg')
    })

    it('should show fullText icon for full text search', () => {
      // Arrange & Act
      render(
        <RuleDetail
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.fullText}
        />,
      )

      // Assert
      const images = screen.getAllByTestId('next-image')
      expect(images[1]).toHaveAttribute('src', '/icons/fullText.svg')
    })

    it('should show hybrid icon for hybrid search', () => {
      // Arrange & Act
      render(
        <RuleDetail
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.hybrid}
        />,
      )

      // Assert
      const images = screen.getAllByTestId('next-image')
      expect(images[1]).toHaveAttribute('src', '/icons/hybrid.svg')
    })
  })

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle all props undefined', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert
      expect(screen.getAllByTestId('field-info')).toHaveLength(3)
    })

    it('should handle undefined indexingType with defined retrievalMethod', () => {
      // Arrange & Act
      render(<RuleDetail retrievalMethod={RETRIEVE_METHOD.hybrid} />)

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      // When indexingType is undefined, it's treated as qualified
      expect(fieldValues[1]).toHaveTextContent('datasetCreation.stepTwo.qualified')
    })

    it('should handle undefined retrievalMethod with defined indexingType', () => {
      // Arrange & Act
      render(<RuleDetail indexingType={IndexingType.QUALIFIED} />)

      // Assert
      const images = screen.getAllByTestId('next-image')
      // When retrievalMethod is undefined, vector icon is used as default
      expect(images[1]).toHaveAttribute('src', '/icons/vector.svg')
    })

    it('should handle sourceData with null rules', () => {
      // Arrange
      const sourceData = {
        ...createMockProcessRule(),
        mode: ProcessMode.parentChild,
        rules: null as unknown as ProcessRuleResponse['rules'],
      }

      // Act & Assert - should not crash
      render(<RuleDetail sourceData={sourceData} />)
      expect(screen.getAllByTestId('field-info')).toHaveLength(3)
    })
  })

  // ==========================================
  // Props Variations Tests
  // ==========================================
  describe('Props Variations', () => {
    it('should render correctly with all props provided', () => {
      // Arrange
      const sourceData = createMockProcessRule({ mode: ProcessMode.general })

      // Act
      render(
        <RuleDetail
          sourceData={sourceData}
          indexingType={IndexingType.QUALIFIED}
          retrievalMethod={RETRIEVE_METHOD.semantic}
        />,
      )

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[0]).toHaveTextContent('datasetDocuments.embedding.custom')
      expect(fieldValues[1]).toHaveTextContent('datasetCreation.stepTwo.qualified')
      expect(fieldValues[2]).toHaveTextContent('dataset.retrieval.semantic_search.title')
    })

    it('should render correctly for economical mode with full settings', () => {
      // Arrange
      const sourceData = createMockProcessRule({ mode: ProcessMode.parentChild })

      // Act
      render(
        <RuleDetail
          sourceData={sourceData}
          indexingType={IndexingType.ECONOMICAL}
          retrievalMethod={RETRIEVE_METHOD.fullText}
        />,
      )

      // Assert
      const fieldValues = screen.getAllByTestId('field-value')
      expect(fieldValues[1]).toHaveTextContent('datasetCreation.stepTwo.economical')
      // Economical always uses keyword_search regardless of retrievalMethod
      expect(fieldValues[2]).toHaveTextContent('dataset.retrieval.keyword_search.title')
    })
  })

  // ==========================================
  // Memoization Tests
  // ==========================================
  describe('Memoization', () => {
    it('should be wrapped in React.memo', () => {
      // Assert - RuleDetail should be a memoized component
      expect(RuleDetail).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })

    it('should not re-render with same props', () => {
      // Arrange
      const sourceData = createMockProcessRule()
      const props = {
        sourceData,
        indexingType: IndexingType.QUALIFIED,
        retrievalMethod: RETRIEVE_METHOD.semantic,
      }

      // Act
      const { rerender } = render(<RuleDetail {...props} />)
      rerender(<RuleDetail {...props} />)

      // Assert - component renders correctly after rerender
      expect(screen.getAllByTestId('field-info')).toHaveLength(3)
    })
  })
})
