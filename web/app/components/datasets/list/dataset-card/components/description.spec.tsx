import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import Description from './description'

describe('Description', () => {
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'This is a test description',
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
    ...overrides,
  } as DataSet)

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const dataset = createMockDataset()
      render(<Description dataset={dataset} />)
      expect(screen.getByText('This is a test description')).toBeInTheDocument()
    })

    it('should render the description text', () => {
      const dataset = createMockDataset({ description: 'Custom description text' })
      render(<Description dataset={dataset} />)
      expect(screen.getByText('Custom description text')).toBeInTheDocument()
    })

    it('should set title attribute for tooltip', () => {
      const dataset = createMockDataset({ description: 'Tooltip description' })
      render(<Description dataset={dataset} />)
      const descDiv = screen.getByTitle('Tooltip description')
      expect(descDiv).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display dataset description', () => {
      const description = 'A very detailed description of this dataset'
      const dataset = createMockDataset({ description })
      render(<Description dataset={dataset} />)
      expect(screen.getByText(description)).toBeInTheDocument()
    })
  })

  describe('Styles', () => {
    it('should have correct base styling when embedding is available', () => {
      const dataset = createMockDataset({ embedding_available: true })
      render(<Description dataset={dataset} />)
      const descDiv = screen.getByTitle(dataset.description)
      expect(descDiv).toHaveClass('system-xs-regular', 'line-clamp-2', 'h-10', 'px-4', 'py-1', 'text-text-tertiary')
    })

    it('should have opacity class when embedding is not available', () => {
      const dataset = createMockDataset({ embedding_available: false })
      render(<Description dataset={dataset} />)
      const descDiv = screen.getByTitle(dataset.description)
      expect(descDiv).toHaveClass('opacity-30')
    })

    it('should not have opacity class when embedding is available', () => {
      const dataset = createMockDataset({ embedding_available: true })
      render(<Description dataset={dataset} />)
      const descDiv = screen.getByTitle(dataset.description)
      expect(descDiv).not.toHaveClass('opacity-30')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty description', () => {
      const dataset = createMockDataset({ description: '' })
      render(<Description dataset={dataset} />)
      const descDiv = screen.getByTitle('')
      expect(descDiv).toBeInTheDocument()
      expect(descDiv).toHaveTextContent('')
    })

    it('should handle very long description', () => {
      const longDescription = 'A'.repeat(500)
      const dataset = createMockDataset({ description: longDescription })
      render(<Description dataset={dataset} />)
      expect(screen.getByText(longDescription)).toBeInTheDocument()
    })

    it('should handle description with special characters', () => {
      const description = '<script>alert("XSS")</script> & "quotes" \'single\''
      const dataset = createMockDataset({ description })
      render(<Description dataset={dataset} />)
      expect(screen.getByText(description)).toBeInTheDocument()
    })
  })
})
