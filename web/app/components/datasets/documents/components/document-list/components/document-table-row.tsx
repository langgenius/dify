import type { FC } from 'react'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { RiEditLine } from '@remixicon/react'
import { pick } from 'es-toolkit/object'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Tooltip from '@/app/components/base/tooltip'
import ChunkingModeLabel from '@/app/components/datasets/common/chunking-mode-label'
import Operations from '@/app/components/datasets/documents/components/operations'
import SummaryStatus from '@/app/components/datasets/documents/detail/completed/common/summary-status'
import StatusItem from '@/app/components/datasets/documents/status-item'
import useTimestamp from '@/hooks/use-timestamp'
import { DataSourceType } from '@/models/datasets'
import { formatNumber } from '@/utils/format'
import DocumentSourceIcon from './document-source-icon'
import { renderTdValue } from './utils'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

type DocumentTableRowProps = {
  doc: LocalDoc
  index: number
  datasetId: string
  isSelected: boolean
  isGeneralMode: boolean
  isQAMode: boolean
  embeddingAvailable: boolean
  selectedIds: string[]
  onSelectOne: (docId: string) => void
  onSelectedIdChange: (ids: string[]) => void
  onShowRenameModal: (doc: LocalDoc) => void
  onUpdate: () => void
}

const renderCount = (count: number | undefined) => {
  if (!count)
    return renderTdValue(0, true)

  if (count < 1000)
    return count

  return `${formatNumber((count / 1000).toFixed(1))}k`
}

const DocumentTableRow: FC<DocumentTableRowProps> = React.memo(({
  doc,
  index,
  datasetId,
  isSelected,
  isGeneralMode,
  isQAMode,
  embeddingAvailable,
  selectedIds,
  onSelectOne,
  onSelectedIdChange,
  onShowRenameModal,
  onUpdate,
}) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const router = useRouter()

  const isFile = doc.data_source_type === DataSourceType.FILE
  const fileType = isFile ? doc.data_source_detail_dict?.upload_file?.extension : ''

  const handleRowClick = useCallback(() => {
    router.push(`/datasets/${datasetId}/documents/${doc.id}`)
  }, [router, datasetId, doc.id])

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  const handleRenameClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onShowRenameModal(doc)
  }, [doc, onShowRenameModal])

  return (
    <tr
      className="h-8 cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover"
      onClick={handleRowClick}
    >
      <td className="text-left align-middle text-xs text-text-tertiary">
        <div className="flex items-center" onClick={handleCheckboxClick}>
          <Checkbox
            className="mr-2 shrink-0"
            checked={isSelected}
            onCheck={() => onSelectOne(doc.id)}
          />
          {index + 1}
        </div>
      </td>
      <td>
        <div className="group mr-6 flex max-w-[460px] items-center hover:mr-0">
          <div className="flex shrink-0 items-center">
            <DocumentSourceIcon doc={doc} fileType={fileType} />
          </div>
          <Tooltip popupContent={doc.name}>
            <span className="grow-1 truncate text-sm">{doc.name}</span>
          </Tooltip>
          {doc.summary_index_status && (
            <div className="ml-1 hidden shrink-0 group-hover:flex">
              <SummaryStatus status={doc.summary_index_status} />
            </div>
          )}
          <div className="hidden shrink-0 group-hover:ml-auto group-hover:flex">
            <Tooltip popupContent={t('list.table.rename', { ns: 'datasetDocuments' })}>
              <div
                className="cursor-pointer rounded-md p-1 hover:bg-state-base-hover"
                onClick={handleRenameClick}
              >
                <RiEditLine className="h-4 w-4 text-text-tertiary" />
              </div>
            </Tooltip>
          </div>
        </div>
      </td>
      <td>
        <ChunkingModeLabel
          isGeneralMode={isGeneralMode}
          isQAMode={isQAMode}
        />
      </td>
      <td>{renderCount(doc.word_count)}</td>
      <td>{renderCount(doc.hit_count)}</td>
      <td className="text-[13px] text-text-secondary">
        {formatTime(doc.created_at, t('dateTimeFormat', { ns: 'datasetHitTesting' }) as string)}
      </td>
      <td>
        <StatusItem status={doc.display_status} />
      </td>
      <td>
        <Operations
          selectedIds={selectedIds}
          onSelectedIdChange={onSelectedIdChange}
          embeddingAvailable={embeddingAvailable}
          datasetId={datasetId}
          detail={pick(doc, ['name', 'enabled', 'archived', 'id', 'data_source_type', 'doc_form', 'display_status'])}
          onUpdate={onUpdate}
        />
      </td>
    </tr>
  )
})

DocumentTableRow.displayName = 'DocumentTableRow'

export default DocumentTableRow
