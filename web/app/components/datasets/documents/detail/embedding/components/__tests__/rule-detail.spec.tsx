import type { ProcessRuleResponse } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../../create/step-two'
import RuleDetail from '../rule-detail'

describe('RuleDetail', () => {
  const defaultProps = {
    indexingType: IndexingType.QUALIFIED,
    retrievalMethod: RETRIEVE_METHOD.semantic,
  }

  const createSourceData = (overrides: Partial<ProcessRuleResponse> = {}): ProcessRuleResponse => ({
    mode: ProcessMode.general,
    rules: {
      segmentation: {
        separator: '\n',
        max_tokens: 500,
        chunk_overlap: 50,
      },
      pre_processing_rules: [
        { id: 'remove_extra_spaces', enabled: true },
        { id: 'remove_urls_emails', enabled: false },
      ],
      parent_mode: 'full-doc',
      subchunk_segmentation: {
        separator: '\n',
        max_tokens: 200,
        chunk_overlap: 20,
      },
    },
    limits: { indexing_max_segmentation_tokens_length: 4000 },
    ...overrides,
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<RuleDetail {...defaultProps} />)
      expect(screen.getByText(/stepTwo\.indexMode/i)).toBeInTheDocument()
    })

    it('should render with sourceData', () => {
      const sourceData = createSourceData()
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/embedding\.mode/i)).toBeInTheDocument()
    })

    it('should render all segmentation rule fields', () => {
      const sourceData = createSourceData()
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/embedding\.mode/i)).toBeInTheDocument()
      expect(screen.getByText(/embedding\.segmentLength/i)).toBeInTheDocument()
      expect(screen.getByText(/embedding\.textCleaning/i)).toBeInTheDocument()
    })
  })

  describe('Mode Display', () => {
    it('should display custom mode for general process mode', () => {
      const sourceData = createSourceData({ mode: ProcessMode.general })
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/embedding\.custom/i)).toBeInTheDocument()
    })

    it('should display mode label field', () => {
      const sourceData = createSourceData()
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/embedding\.mode/i)).toBeInTheDocument()
    })
  })

  describe('Segment Length Display', () => {
    it('should display max tokens for general mode', () => {
      const sourceData = createSourceData({
        mode: ProcessMode.general,
        rules: {
          segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
          pre_processing_rules: [],
          parent_mode: 'full-doc',
          subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 20 },
        },
      })
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText('500')).toBeInTheDocument()
    })

    it('should display segment length label', () => {
      const sourceData = createSourceData()
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/embedding\.segmentLength/i)).toBeInTheDocument()
    })
  })

  describe('Text Cleaning Display', () => {
    it('should display enabled pre-processing rules', () => {
      const sourceData = createSourceData({
        rules: {
          segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: true },
            { id: 'remove_urls_emails', enabled: true },
          ],
          parent_mode: 'full-doc',
          subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 20 },
        },
      })
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/removeExtraSpaces/i)).toBeInTheDocument()
      expect(screen.getByText(/removeUrlEmails/i)).toBeInTheDocument()
    })

    it('should display text cleaning label', () => {
      const sourceData = createSourceData()
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/embedding\.textCleaning/i)).toBeInTheDocument()
    })
  })

  describe('Index Mode Display', () => {
    it('should display economical mode when indexingType is ECONOMICAL', () => {
      render(<RuleDetail {...defaultProps} indexingType={IndexingType.ECONOMICAL} />)
      expect(screen.getByText(/stepTwo\.economical/i)).toBeInTheDocument()
    })

    it('should display qualified mode when indexingType is QUALIFIED', () => {
      render(<RuleDetail {...defaultProps} indexingType={IndexingType.QUALIFIED} />)
      expect(screen.getByText(/stepTwo\.qualified/i)).toBeInTheDocument()
    })
  })

  describe('Retrieval Method Display', () => {
    it('should display keyword search for economical mode', () => {
      render(<RuleDetail {...defaultProps} indexingType={IndexingType.ECONOMICAL} />)
      expect(screen.getByText(/retrieval\.keyword_search\.title/i)).toBeInTheDocument()
    })

    it('should display semantic search as default for qualified mode', () => {
      render(<RuleDetail {...defaultProps} indexingType={IndexingType.QUALIFIED} />)
      expect(screen.getByText(/retrieval\.semantic_search\.title/i)).toBeInTheDocument()
    })

    it('should display full text search when retrievalMethod is fullText', () => {
      render(<RuleDetail {...defaultProps} retrievalMethod={RETRIEVE_METHOD.fullText} />)
      expect(screen.getByText(/retrieval\.full_text_search\.title/i)).toBeInTheDocument()
    })

    it('should display hybrid search when retrievalMethod is hybrid', () => {
      render(<RuleDetail {...defaultProps} retrievalMethod={RETRIEVE_METHOD.hybrid} />)
      expect(screen.getByText(/retrieval\.hybrid_search\.title/i)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should display dash for missing sourceData', () => {
      render(<RuleDetail {...defaultProps} />)
      const dashes = screen.getAllByText('-')
      expect(dashes.length).toBeGreaterThan(0)
    })

    it('should display dash when mode is undefined', () => {
      const sourceData = { rules: {} } as ProcessRuleResponse
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      const dashes = screen.getAllByText('-')
      expect(dashes.length).toBeGreaterThan(0)
    })

    it('should handle undefined retrievalMethod', () => {
      render(<RuleDetail indexingType={IndexingType.QUALIFIED} />)
      expect(screen.getByText(/retrieval\.semantic_search\.title/i)).toBeInTheDocument()
    })

    it('should handle empty pre_processing_rules array', () => {
      const sourceData = createSourceData({
        rules: {
          segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
          pre_processing_rules: [],
          parent_mode: 'full-doc',
          subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 20 },
        },
      })
      render(<RuleDetail {...defaultProps} sourceData={sourceData} />)
      expect(screen.getByText(/embedding\.textCleaning/i)).toBeInTheDocument()
    })

    it('should render container with correct structure', () => {
      const { container } = render(<RuleDetail {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('py-3')
    })

    it('should handle undefined indexingType', () => {
      render(<RuleDetail retrievalMethod={RETRIEVE_METHOD.semantic} />)
      expect(screen.getByText(/stepTwo\.indexMode/i)).toBeInTheDocument()
    })

    it('should render divider between sections', () => {
      const { container } = render(<RuleDetail {...defaultProps} />)
      const dividers = container.querySelectorAll('.bg-divider-subtle')
      expect(dividers.length).toBeGreaterThan(0)
    })
  })
})
