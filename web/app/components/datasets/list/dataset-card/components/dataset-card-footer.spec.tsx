import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import DatasetCardFooter from './dataset-card-footer'

// Mock the useFormatTimeFromNow hook
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: vi.fn((timestamp: number) => {
      const date = new Date(timestamp)
      return `${date.toLocaleDateString()}`
    }),
  }),
}))

describe('DatasetCardFooter', () => {
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
    total_available_documents: 10,
    ...overrides,
  } as DataSet)

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const dataset = createMockDataset()
      render(<DatasetCardFooter dataset={dataset} />)
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should render document count', () => {
      const dataset = createMockDataset({ document_count: 25, total_available_documents: 25 })
      render(<DatasetCardFooter dataset={dataset} />)
      expect(screen.getByText('25')).toBeInTheDocument()
    })

    it('should render app count for non-external provider', () => {
      const dataset = createMockDataset({ app_count: 8, provider: 'vendor' })
      render(<DatasetCardFooter dataset={dataset} />)
      expect(screen.getByText('8')).toBeInTheDocument()
    })

    it('should not render app count for external provider', () => {
      const dataset = createMockDataset({ app_count: 8, provider: 'external' })
      render(<DatasetCardFooter dataset={dataset} />)
      // App count should not be rendered
      const appCounts = screen.queryAllByText('8')
      expect(appCounts.length).toBe(0)
    })

    it('should render update time', () => {
      const dataset = createMockDataset()
      render(<DatasetCardFooter dataset={dataset} />)
      // Check for "updated" text with i18n key
      expect(screen.getByText(/updated/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should show partial document count when total_available_documents < document_count', () => {
      const dataset = createMockDataset({
        document_count: 20,
        total_available_documents: 15,
      })
      render(<DatasetCardFooter dataset={dataset} />)
      expect(screen.getByText('15 / 20')).toBeInTheDocument()
    })

    it('should show full document count when all documents are available', () => {
      const dataset = createMockDataset({
        document_count: 20,
        total_available_documents: 20,
      })
      render(<DatasetCardFooter dataset={dataset} />)
      expect(screen.getByText('20')).toBeInTheDocument()
    })

    it('should handle zero documents', () => {
      const dataset = createMockDataset({
        document_count: 0,
        total_available_documents: 0,
      })
      render(<DatasetCardFooter dataset={dataset} />)
      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })

  describe('Styles', () => {
    it('should have correct base styling when embedding is available', () => {
      const dataset = createMockDataset({ embedding_available: true })
      const { container } = render(<DatasetCardFooter dataset={dataset} />)
      const footer = container.firstChild as HTMLElement
      expect(footer).toHaveClass('flex', 'items-center', 'gap-x-3', 'px-4')
    })

    it('should have opacity class when embedding is not available', () => {
      const dataset = createMockDataset({ embedding_available: false })
      const { container } = render(<DatasetCardFooter dataset={dataset} />)
      const footer = container.firstChild as HTMLElement
      expect(footer).toHaveClass('opacity-30')
    })

    it('should not have opacity class when embedding is available', () => {
      const dataset = createMockDataset({ embedding_available: true })
      const { container } = render(<DatasetCardFooter dataset={dataset} />)
      const footer = container.firstChild as HTMLElement
      expect(footer).not.toHaveClass('opacity-30')
    })
  })

  describe('Icons', () => {
    it('should render document icon', () => {
      const dataset = createMockDataset()
      const { container } = render(<DatasetCardFooter dataset={dataset} />)
      // RiFileTextFill icon
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThanOrEqual(1)
    })

    it('should render robot icon for non-external provider', () => {
      const dataset = createMockDataset({ provider: 'vendor' })
      const { container } = render(<DatasetCardFooter dataset={dataset} />)
      // Should have both file and robot icons
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBe(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined total_available_documents', () => {
      const dataset = createMockDataset({
        document_count: 10,
        total_available_documents: undefined,
      })
      render(<DatasetCardFooter dataset={dataset} />)
      // Should show 0 / 10 since total_available_documents defaults to 0
      expect(screen.getByText('0 / 10')).toBeInTheDocument()
    })

    it('should handle very large numbers', () => {
      const dataset = createMockDataset({
        document_count: 999999,
        total_available_documents: 999999,
        app_count: 888888,
      })
      render(<DatasetCardFooter dataset={dataset} />)
      expect(screen.getByText('999999')).toBeInTheDocument()
      expect(screen.getByText('888888')).toBeInTheDocument()
    })

    it('should handle zero app count', () => {
      const dataset = createMockDataset({ app_count: 0, document_count: 5, total_available_documents: 5 })
      render(<DatasetCardFooter dataset={dataset} />)
      // Both document count and app count are shown
      const zeros = screen.getAllByText('0')
      expect(zeros.length).toBeGreaterThanOrEqual(1)
    })
  })
})
