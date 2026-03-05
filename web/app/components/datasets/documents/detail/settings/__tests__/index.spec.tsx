import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from '../index'

// Mock the dataset detail context
let mockRuntimeMode: string | undefined = 'general'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { runtime_mode: string | undefined } }) => unknown) => {
    return selector({ dataset: { runtime_mode: mockRuntimeMode } })
  },
}))

vi.mock('../document-settings', () => ({
  default: ({ datasetId, documentId }: { datasetId: string, documentId: string }) => (
    <div data-testid="document-settings">
      DocumentSettings -
      {' '}
      {datasetId}
      {' '}
      -
      {' '}
      {documentId}
    </div>
  ),
}))

vi.mock('../pipeline-settings', () => ({
  default: ({ datasetId, documentId }: { datasetId: string, documentId: string }) => (
    <div data-testid="pipeline-settings">
      PipelineSettings -
      {' '}
      {datasetId}
      {' '}
      -
      {' '}
      {documentId}
    </div>
  ),
}))

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntimeMode = 'general'
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <Settings datasetId="dataset-1" documentId="doc-1" />,
      )

      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // Conditional rendering tests
  describe('Conditional Rendering', () => {
    it('should render DocumentSettings when runtimeMode is general', () => {
      mockRuntimeMode = 'general'

      render(<Settings datasetId="dataset-1" documentId="doc-1" />)

      expect(screen.getByTestId('document-settings')).toBeInTheDocument()
      expect(screen.queryByTestId('pipeline-settings')).not.toBeInTheDocument()
    })

    it('should render PipelineSettings when runtimeMode is not general', () => {
      mockRuntimeMode = 'pipeline'

      render(<Settings datasetId="dataset-1" documentId="doc-1" />)

      expect(screen.getByTestId('pipeline-settings')).toBeInTheDocument()
      expect(screen.queryByTestId('document-settings')).not.toBeInTheDocument()
    })
  })

  // Props passing tests
  describe('Props', () => {
    it('should pass datasetId and documentId to DocumentSettings', () => {
      mockRuntimeMode = 'general'

      render(<Settings datasetId="test-dataset" documentId="test-document" />)

      expect(screen.getByText(/test-dataset/)).toBeInTheDocument()
      expect(screen.getByText(/test-document/)).toBeInTheDocument()
    })

    it('should pass datasetId and documentId to PipelineSettings', () => {
      mockRuntimeMode = 'pipeline'

      render(<Settings datasetId="test-dataset" documentId="test-document" />)

      expect(screen.getByText(/test-dataset/)).toBeInTheDocument()
      expect(screen.getByText(/test-document/)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined runtimeMode as non-general', () => {
      mockRuntimeMode = undefined

      render(<Settings datasetId="dataset-1" documentId="doc-1" />)

      // Assert - undefined !== 'general', so PipelineSettings should render
      expect(screen.getByTestId('pipeline-settings')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      mockRuntimeMode = 'general'
      const { rerender } = render(
        <Settings datasetId="dataset-1" documentId="doc-1" />,
      )

      rerender(<Settings datasetId="dataset-2" documentId="doc-2" />)

      expect(screen.getByText(/dataset-2/)).toBeInTheDocument()
    })
  })
})
