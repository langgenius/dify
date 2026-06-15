import type { SimpleDocumentDetail } from '@/models/datasets'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode, DataSourceType } from '@/models/datasets'

import { DocumentTitle } from '../document-title'

const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('../../../common/document-picker', () => ({
  DocumentPicker: ({
    datasetId,
    value,
    parentMode,
    onChange,
  }: {
    datasetId: string
    value?: SimpleDocumentDetail | null
    parentMode?: string
    onChange: (doc: { id: string }) => void
  }) => (
    <div
      data-testid="document-picker"
      data-dataset-id={datasetId}
      data-value-id={value?.id ?? ''}
      data-parent-mode={parentMode ?? ''}
      onClick={() => onChange({ id: 'new-doc-id' })}
    >
      Document Picker
    </div>
  ),
}))

const createDocument = (overrides: Partial<SimpleDocumentDetail> = {}): SimpleDocumentDetail => ({
  id: 'doc-1',
  batch: 'batch-1',
  position: 1,
  dataset_id: 'dataset-1',
  data_source_type: DataSourceType.FILE,
  data_source_info: {
    upload_file: {
      id: 'file-1',
      name: 'document.pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: 'user-1',
      created_at: Date.now(),
    },
    job_id: 'job-1',
    url: '',
  },
  dataset_process_rule_id: 'rule-1',
  name: 'Document 1',
  created_from: 'web',
  created_by: 'user-1',
  created_at: Date.now(),
  indexing_status: 'completed',
  display_status: 'enabled',
  doc_form: ChunkingMode.text,
  doc_language: 'en',
  enabled: true,
  word_count: 1000,
  archived: false,
  updated_at: Date.now(),
  hit_count: 0,
  ...overrides,
})

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

    it('should pass the selected document to DocumentPicker', () => {
      const document = createDocument({ id: 'doc-current' })
      const { getByTestId } = render(
        <DocumentTitle
          datasetId="dataset-1"
          document={document}
          parentMode="paragraph"
        />,
      )

      expect(getByTestId('document-picker')).toHaveAttribute('data-value-id', 'doc-current')
      expect(getByTestId('document-picker')).toHaveAttribute('data-parent-mode', 'paragraph')
    })

    it('should pass no parent mode when it is undefined', () => {
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      expect(getByTestId('document-picker')).toHaveAttribute('data-parent-mode', '')
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
    it('should handle an empty document value', () => {
      const { getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" />,
      )

      expect(getByTestId('document-picker')).toHaveAttribute('data-value-id', '')
    })

    it('should maintain structure when rerendered', () => {
      const { rerender, getByTestId } = render(
        <DocumentTitle datasetId="dataset-1" document={createDocument({ id: 'doc-1' })} />,
      )

      rerender(<DocumentTitle datasetId="dataset-2" document={createDocument({ id: 'doc-2' })} />)

      expect(getByTestId('document-picker').getAttribute('data-dataset-id')).toBe('dataset-2')
      expect(getByTestId('document-picker').getAttribute('data-value-id')).toBe('doc-2')
    })
  })
})
