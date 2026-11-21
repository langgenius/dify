'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { MenuItem, MenuLinkItem, MenuList } from '@langgenius/dify-ui/menu'
import { SpinnerIcon } from '@langgenius/dify-ui/spinner'
import { useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useTranslation } from 'react-i18next'
import { getUploadFileExtension } from '@/app/components/datasets/documents/document-source'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import FileIcon from '../document-file-icon'

type DocumentListProps = {
  datasetId: string
  currentDocumentId?: string
  searchValue: string
}

function getDocumentExtension(document: DocumentWithSegmentsResponse) {
  const detailExtension = document.data_source_detail_dict?.upload_file?.extension
  if (detailExtension) return detailExtension

  return getUploadFileExtension(document.data_source_info) ?? ''
}

export default function DocumentList({
  datasetId,
  currentDocumentId,
  searchValue,
}: DocumentListProps) {
  const { t } = useTranslation(['common'])
  const keyword = searchValue.trim()
  const debouncedKeyword = useDebouncedValue(keyword, 500)
  const documentsQuery = useQuery(
    consoleQuery.datasets.byDatasetId.documents.get.queryOptions({
      input: {
        params: { dataset_id: datasetId },
        query: { keyword: debouncedKeyword, page: 1, limit: 20 },
      },
    }),
  )
  const isSearching = keyword !== debouncedKeyword || documentsQuery.isPending
  const isError = !isSearching && documentsQuery.isError
  // Previous-query links must not remain actionable during the debounce window.
  const documents = isSearching || isError ? [] : (documentsQuery.data?.data ?? [])
  const statusText = isSearching
    ? t(($) => $.loading, { ns: 'common' })
    : isError
      ? t(($) => $['dynamicSelect.error'], { ns: 'common' })
      : documents.length === 0
        ? t(($) => $.noData, { ns: 'common' })
        : null

  return (
    <>
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-2 system-sm-regular text-text-tertiary empty:p-0"
      >
        {isSearching && <SpinnerIcon aria-hidden="true" />}
        {statusText}
      </div>
      <MenuList aria-busy={isSearching}>
        {documents.map((document) => (
          <MenuLinkItem
            key={document.id}
            render={<Link href={`/datasets/${datasetId}/documents/${document.id}`} />}
            aria-current={document.id === currentDocumentId ? 'page' : undefined}
            className="gap-2 px-3"
          >
            <FileIcon name={document.name} extension={getDocumentExtension(document)} size="lg" />
            <span className="min-w-0 truncate system-sm-regular text-text-secondary">
              {document.name}
            </span>
          </MenuLinkItem>
        ))}
        {isError && (
          <MenuItem closeOnClick={false} onClick={() => documentsQuery.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </MenuItem>
        )}
      </MenuList>
    </>
  )
}
