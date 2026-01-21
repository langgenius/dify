import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import CornerLabels from './corner-labels'

describe('CornerLabels', () => {
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: true,
    app_count: 5,
    document_count: 10,
    word_count: 1000,
    created_at: 1609459200,
    updated_at: 1609545600,
    tags: [],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    runtime_mode: 'general',
    ...overrides,
  } as DataSet)

  describe('Rendering', () => {
    it('should render without crashing when embedding is available', () => {
      const dataset = createMockDataset({ embedding_available: true })
      const { container } = render(<CornerLabels dataset={dataset} />)
      // Should render null when embedding is available and not pipeline
      expect(container.firstChild).toBeNull()
    })

    it('should render unavailable label when embedding is not available', () => {
      const dataset = createMockDataset({ embedding_available: false })
      render(<CornerLabels dataset={dataset} />)
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    })

    it('should render pipeline label when runtime_mode is rag_pipeline', () => {
      const dataset = createMockDataset({
        embedding_available: true,
        runtime_mode: 'rag_pipeline',
      })
      render(<CornerLabels dataset={dataset} />)
      expect(screen.getByText(/pipeline/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should not render when embedding is available and not pipeline', () => {
      const dataset = createMockDataset({
        embedding_available: true,
        runtime_mode: 'general',
      })
      const { container } = render(<CornerLabels dataset={dataset} />)
      expect(container.firstChild).toBeNull()
    })

    it('should prioritize unavailable label over pipeline label', () => {
      const dataset = createMockDataset({
        embedding_available: false,
        runtime_mode: 'rag_pipeline',
      })
      render(<CornerLabels dataset={dataset} />)
      // Should show unavailable since embedding_available is checked first
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
      expect(screen.queryByText(/pipeline/i)).not.toBeInTheDocument()
    })
  })

  describe('Styles', () => {
    it('should have correct positioning for unavailable label', () => {
      const dataset = createMockDataset({ embedding_available: false })
      const { container } = render(<CornerLabels dataset={dataset} />)
      const labelContainer = container.firstChild as HTMLElement
      expect(labelContainer).toHaveClass('absolute', 'right-0', 'top-0', 'z-10')
    })

    it('should have correct positioning for pipeline label', () => {
      const dataset = createMockDataset({
        embedding_available: true,
        runtime_mode: 'rag_pipeline',
      })
      const { container } = render(<CornerLabels dataset={dataset} />)
      const labelContainer = container.firstChild as HTMLElement
      expect(labelContainer).toHaveClass('absolute', 'right-0', 'top-0', 'z-10')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined runtime_mode', () => {
      const dataset = createMockDataset({
        embedding_available: true,
        runtime_mode: undefined,
      })
      const { container } = render(<CornerLabels dataset={dataset} />)
      expect(container.firstChild).toBeNull()
    })

    it('should handle empty string runtime_mode', () => {
      const dataset = createMockDataset({
        embedding_available: true,
        runtime_mode: '' as DataSet['runtime_mode'],
      })
      const { container } = render(<CornerLabels dataset={dataset} />)
      expect(container.firstChild).toBeNull()
    })

    it('should handle all false conditions', () => {
      const dataset = createMockDataset({
        embedding_available: true,
        runtime_mode: 'general',
      })
      const { container } = render(<CornerLabels dataset={dataset} />)
      expect(container.firstChild).toBeNull()
    })
  })
})
