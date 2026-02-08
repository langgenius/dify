import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { RETRIEVE_METHOD } from '@/types/app'
import { retrievalIcon } from '../../create/icons'
import RetrievalMethodInfo, { getIcon } from './index'

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, className }: { src: string, alt: string, className?: string }) => (
    <img src={src} alt={alt || ''} className={className} data-testid="method-icon" />
  ),
}))

// Mock RadioCard
vi.mock('@/app/components/base/radio-card', () => ({
  default: ({ title, description, chosenConfig, icon }: { title: string, description: string, chosenConfig: ReactNode, icon: ReactNode }) => (
    <div data-testid="radio-card">
      <div data-testid="card-title">{title}</div>
      <div data-testid="card-description">{description}</div>
      <div data-testid="card-icon">{icon}</div>
      <div data-testid="chosen-config">{chosenConfig}</div>
    </div>
  ),
}))

// Mock icons
vi.mock('../../create/icons', () => ({
  retrievalIcon: {
    vector: 'vector-icon.png',
    fullText: 'fulltext-icon.png',
    hybrid: 'hybrid-icon.png',
  },
}))

describe('RetrievalMethodInfo', () => {
  const defaultConfig = {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: 'test-provider',
      reranking_model_name: 'test-model',
    },
    top_k: 5,
    score_threshold_enabled: true,
    score_threshold: 0.8,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render correctly with full config', () => {
    render(<RetrievalMethodInfo value={defaultConfig} />)

    expect(screen.getByTestId('radio-card')).toBeInTheDocument()

    // Check Title & Description (mocked i18n returns key prefixed with ns)
    expect(screen.getByTestId('card-title')).toHaveTextContent('dataset.retrieval.semantic_search.title')
    expect(screen.getByTestId('card-description')).toHaveTextContent('dataset.retrieval.semantic_search.description')

    // Check Icon
    const icon = screen.getByTestId('method-icon')
    expect(icon).toHaveAttribute('src', 'vector-icon.png')

    // Check Config Details
    expect(screen.getByText('test-model')).toBeInTheDocument() // Rerank model
    expect(screen.getByText('5')).toBeInTheDocument() // Top K
    expect(screen.getByText('0.8')).toBeInTheDocument() // Score threshold
  })

  it('should not render reranking model if missing', () => {
    const configWithoutRerank = {
      ...defaultConfig,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
    }

    render(<RetrievalMethodInfo value={configWithoutRerank} />)

    expect(screen.queryByText('test-model')).not.toBeInTheDocument()
    // Other fields should still be there
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('should handle different retrieval methods', () => {
    // Test Hybrid
    const hybridConfig = { ...defaultConfig, search_method: RETRIEVE_METHOD.hybrid }
    const { unmount } = render(<RetrievalMethodInfo value={hybridConfig} />)

    expect(screen.getByTestId('card-title')).toHaveTextContent('dataset.retrieval.hybrid_search.title')
    expect(screen.getByTestId('method-icon')).toHaveAttribute('src', 'hybrid-icon.png')

    unmount()

    // Test FullText
    const fullTextConfig = { ...defaultConfig, search_method: RETRIEVE_METHOD.fullText }
    render(<RetrievalMethodInfo value={fullTextConfig} />)
    expect(screen.getByTestId('card-title')).toHaveTextContent('dataset.retrieval.full_text_search.title')
    expect(screen.getByTestId('method-icon')).toHaveAttribute('src', 'fulltext-icon.png')
  })

  describe('getIcon utility', () => {
    it('should return correct icon for each type', () => {
      expect(getIcon(RETRIEVE_METHOD.semantic)).toBe(retrievalIcon.vector)
      expect(getIcon(RETRIEVE_METHOD.fullText)).toBe(retrievalIcon.fullText)
      expect(getIcon(RETRIEVE_METHOD.hybrid)).toBe(retrievalIcon.hybrid)
      expect(getIcon(RETRIEVE_METHOD.invertedIndex)).toBe(retrievalIcon.vector)
      expect(getIcon(RETRIEVE_METHOD.keywordSearch)).toBe(retrievalIcon.vector)
    })

    it('should return default vector icon for unknown type', () => {
      // Test fallback branch when type is not in the mapping
      const unknownType = 'unknown_method' as RETRIEVE_METHOD
      expect(getIcon(unknownType)).toBe(retrievalIcon.vector)
    })
  })

  it('should not render score threshold if disabled', () => {
    const configWithoutScoreThreshold = {
      ...defaultConfig,
      score_threshold_enabled: false,
      score_threshold: 0,
    }

    render(<RetrievalMethodInfo value={configWithoutScoreThreshold} />)

    // score_threshold is still rendered but may be undefined
    expect(screen.queryByText('0.8')).not.toBeInTheDocument()
  })

  it('should render correctly with invertedIndex search method', () => {
    const invertedIndexConfig = { ...defaultConfig, search_method: RETRIEVE_METHOD.invertedIndex }
    render(<RetrievalMethodInfo value={invertedIndexConfig} />)

    // invertedIndex uses vector icon
    expect(screen.getByTestId('method-icon')).toHaveAttribute('src', 'vector-icon.png')
  })

  it('should render correctly with keywordSearch search method', () => {
    const keywordSearchConfig = { ...defaultConfig, search_method: RETRIEVE_METHOD.keywordSearch }
    render(<RetrievalMethodInfo value={keywordSearchConfig} />)

    // keywordSearch uses vector icon
    expect(screen.getByTestId('method-icon')).toHaveAttribute('src', 'vector-icon.png')
  })
})
