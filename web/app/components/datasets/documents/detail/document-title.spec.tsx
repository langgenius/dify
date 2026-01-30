import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'

import { DocumentTitle } from './document-title'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock DocumentPicker
vi.mock('../../common/document-picker', () => ({
  default: ({ datasetId, value, onChange }: { datasetId: string, value: unknown, onChange: (doc: { id: string }) => void }) => (
    <div
      data-testid="document-picker"
      data-dataset-id={datasetId}
      data-value={JSON.stringify(value)}
      onClick={() => onChange({ id: 'new-doc-id' })}
    >
      Document Picker
    </div>
  ),
}))

describe('DocumentTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render DocumentPicker component', () => {
      // Arrange & Act
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      // Assert
      expect(getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      // Arrange & Act
      const { container } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('flex-1')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-start')
    })
  })

  // Props tests
  describe('Props', () => {
    it('should pass datasetId to DocumentPicker', () => {
      // Arrange & Act
      const { getByTestId } = render(
        <DocumentTitle datasetId="test-dataset-id" />,
      )

      // Assert
      expect(getByTestId('document-picker').getAttribute('data-dataset-id')).toBe('test-dataset-id')
    })

    it('should pass value props to DocumentPicker', () => {
      // Arrange & Act
      const { getByTestId } = render(
        <DocumentTitle
          datasetId="dataset-1"
          name="test-document"
          extension="pdf"
          chunkingMode={ChunkingMode.text}
          parent_mode="paragraph"
        />,
      )

      // Assert
      const value = JSON.parse(getByTestId('document-picker').getAttribute('data-value') || '{}')
      expect(value.name).toBe('test-document')
      expect(value.extension).toBe('pdf')
      expect(value.chunkingMode).toBe(ChunkingMode.text)
      expect(value.parentMode).toBe('paragraph')
    })

    it('should default parentMode to paragraph when parent_mode is undefined', () => {
      // Arrange & Act
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      // Assert
      const value = JSON.parse(getByTestId('document-picker').getAttribute('data-value') || '{}')
      expect(value.parentMode).toBe('paragraph')
    })

    it('should apply custom wrapperCls', () => {
      // Arrange & Act
      const { container } = render(
        <DocumentTitle datasetId="dataset-1" wrapperCls="custom-wrapper" />,
      )

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-wrapper')
    })
  })

  // Navigation tests
  describe('Navigation', () => {
    it('should navigate to document page when document is selected', () => {
      // Arrange
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      // Act
      getByTestId('document-picker').click()

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/new-doc-id')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle undefined optional props', () => {
      // Arrange & Act
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      // Assert
      const value = JSON.parse(getByTestId('document-picker').getAttribute('data-value') || '{}')
      expect(value.name).toBeUndefined()
      expect(value.extension).toBeUndefined()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender, getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" name="doc1" />,
      )

      // Act
      rerender(<DocumentTitle datasetId="dataset-2" name="doc2" />)

      // Assert
      expect(getByTestId('document-picker').getAttribute('data-dataset-id')).toBe('dataset-2')
    })
  })
})
