import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'

import { DocumentTitle } from '../document-title'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock DocumentPicker
vi.mock('../../../common/document-picker', () => ({
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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render DocumentPicker component', () => {
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      expect(getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      const { container } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('flex-1')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-start')
    })
  })

  describe('Props', () => {
    it('should pass datasetId to DocumentPicker', () => {
      const { getByTestId } = render(
        <DocumentTitle datasetId="test-dataset-id" />,
      )

      expect(getByTestId('document-picker').getAttribute('data-dataset-id')).toBe('test-dataset-id')
    })

    it('should pass value props to DocumentPicker', () => {
      const { getByTestId } = render(
        <DocumentTitle
          datasetId="dataset-1"
          name="test-document"
          extension="pdf"
          chunkingMode={ChunkingMode.text}
          parent_mode="paragraph"
        />,
      )

      const value = JSON.parse(getByTestId('document-picker').getAttribute('data-value') || '{}')
      expect(value.name).toBe('test-document')
      expect(value.extension).toBe('pdf')
      expect(value.chunkingMode).toBe(ChunkingMode.text)
      expect(value.parentMode).toBe('paragraph')
    })

    it('should default parentMode to paragraph when parent_mode is undefined', () => {
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      const value = JSON.parse(getByTestId('document-picker').getAttribute('data-value') || '{}')
      expect(value.parentMode).toBe('paragraph')
    })

    it('should apply custom wrapperCls', () => {
      const { container } = render(
        <DocumentTitle datasetId="dataset-1" wrapperCls="custom-wrapper" />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-wrapper')
    })
  })

  describe('Navigation', () => {
    it('should navigate to document page when document is selected', () => {
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      getByTestId('document-picker').click()

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/new-doc-id')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined optional props', () => {
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      const value = JSON.parse(getByTestId('document-picker').getAttribute('data-value') || '{}')
      expect(value.name).toBeUndefined()
      expect(value.extension).toBeUndefined()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender, getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" name="doc1" />,
      )

      rerender(<DocumentTitle datasetId="dataset-2" name="doc2" />)

      expect(getByTestId('document-picker').getAttribute('data-dataset-id')).toBe('dataset-2')
    })
  })
})
