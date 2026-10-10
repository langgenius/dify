import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import MetadataDocument from '../index'

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContext: () => ({ dataset: { embedding_available: true } }),
}))

vi.mock('@/service/knowledge/use-metadata', () => ({
  useBatchUpdateDocMetadata: () => ({ mutateAsync: vi.fn() }),
  useCreateMetaData: () => ({ mutateAsync: vi.fn() }),
  useDocumentMetaData: () => ({ data: { doc_metadata: [] } }),
  useDatasetMetaData: () => ({ data: { built_in_field_enabled: false } }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => new Date(timestamp * 1000).toISOString(),
  }),
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'metadata.field.originInfo.originalFileSize': 'Original file size',
    'metadata.field.originInfo.lastUpdateDate': 'Last update date',
  })
})

type DocumentDetail = Parameters<typeof MetadataDocument>[0]['docDetail']

const uploadFile = { name: 'handbook.txt', extension: 'txt', size: 497 }

// The Console detail endpoint separates the upload reference from its details.
const documentDetail: Partial<DocumentDetail> = {
  id: 'document-1',
  name: 'handbook.txt',
  data_source_type: 'upload_file',
  data_source_info: { upload_file_id: 'upload-1' },
  data_source_detail_dict: {
    upload_file: uploadFile,
  },
  created_at: Date.parse('2026-09-23T10:30:00Z') / 1000,
  completed_at: Date.parse('2026-09-23T10:32:00Z') / 1000,
  updated_at: Date.parse('2026-09-23T10:33:00Z') / 1000,
}

const renderDocument = (detail: Partial<DocumentDetail>) => (
  <MetadataDocument
    datasetId="dataset-1"
    documentId="document-1"
    docDetail={detail as DocumentDetail}
  />
)

describe('Document information', () => {
  it('shows the uploaded file size from the document detail response', () => {
    render(renderDocument(documentDetail))

    expect(screen.getByText('497.00 bytes')).toBeInTheDocument()
  })

  it('shows the last modification time and refreshes it when document details change', () => {
    const { rerender } = render(renderDocument(documentDetail))

    expect(screen.getByText('2026-09-23T10:33:00.000Z')).toBeInTheDocument()
    expect(screen.queryByText('2026-09-23T10:32:00.000Z')).not.toBeInTheDocument()

    rerender(
      renderDocument({
        ...documentDetail,
        updated_at: Date.parse('2026-09-23T10:38:00Z') / 1000,
      }),
    )

    expect(screen.getByText('2026-09-23T10:38:00.000Z')).toBeInTheDocument()
    expect(screen.queryByText('2026-09-23T10:33:00.000Z')).not.toBeInTheDocument()
  })

  it.each(['notion_import', 'website_crawl'] as const)(
    'keeps the missing-size placeholder for %s documents',
    (dataSourceType) => {
      render(
        renderDocument({
          ...documentDetail,
          data_source_type: dataSourceType,
          data_source_info: {},
          data_source_detail_dict: {},
        } as DocumentDetail),
      )

      expect(screen.getByText('Original file size').parentElement).toHaveTextContent(
        'Original file size-',
      )
    },
  )
})
