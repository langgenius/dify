'use client'
import type { FC } from 'react'
import type { Item } from '@/app/components/base/select'
import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import type { SortType } from '@/service/datasets'
import { PlusIcon } from '@heroicons/react/24/solid'
import { RiDraftLine, RiExternalLinkLine } from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Chip from '@/app/components/base/chip'
import Input from '@/app/components/base/input'
import Sort from '@/app/components/base/sort'
import AutoDisabledDocument from '@/app/components/datasets/common/document-status-with-action/auto-disabled-document'
import IndexFailed from '@/app/components/datasets/common/document-status-with-action/index-failed'
import StatusWithAction from '@/app/components/datasets/common/document-status-with-action/status-with-action'
import DatasetMetadataDrawer from '@/app/components/datasets/metadata/metadata-dataset/dataset-metadata-drawer'
import { useDocLink } from '@/context/i18n'
import { DataSourceType } from '@/models/datasets'
import { useIndexStatus } from '../status-item/hooks'

type DocumentsHeaderProps = {
  // Dataset info
  datasetId: string
  dataSourceType?: DataSourceType
  embeddingAvailable: boolean
  isFreePlan: boolean

  // Filter & sort
  statusFilterValue: string
  sortValue: SortType
  inputValue: string
  onStatusFilterChange: (value: string) => void
  onStatusFilterClear: () => void
  onSortChange: (value: string) => void
  onInputChange: (value: string) => void

  // Metadata modal
  isShowEditMetadataModal: boolean
  showEditMetadataModal: () => void
  hideEditMetadataModal: () => void
  datasetMetaData?: MetadataItemWithValueLength[]
  builtInMetaData?: BuiltInMetadataItem[]
  builtInEnabled: boolean
  onAddMetaData: (payload: BuiltInMetadataItem) => Promise<void>
  onRenameMetaData: (payload: MetadataItemWithValueLength) => Promise<void>
  onDeleteMetaData: (metaDataId: string) => Promise<void>
  onBuiltInEnabledChange: (enabled: boolean) => void

  // Actions
  onAddDocument: () => void
}

const DocumentsHeader: FC<DocumentsHeaderProps> = ({
  datasetId,
  dataSourceType,
  embeddingAvailable,
  isFreePlan,
  statusFilterValue,
  sortValue,
  inputValue,
  onStatusFilterChange,
  onStatusFilterClear,
  onSortChange,
  onInputChange,
  isShowEditMetadataModal,
  showEditMetadataModal,
  hideEditMetadataModal,
  datasetMetaData,
  builtInMetaData,
  builtInEnabled,
  onAddMetaData,
  onRenameMetaData,
  onDeleteMetaData,
  onBuiltInEnabledChange,
  onAddDocument,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const DOC_INDEX_STATUS_MAP = useIndexStatus()

  const isDataSourceNotion = dataSourceType === DataSourceType.NOTION
  const isDataSourceWeb = dataSourceType === DataSourceType.WEB

  const statusFilterItems: Item[] = useMemo(() => [
    { value: 'all', name: t('list.index.all', { ns: 'datasetDocuments' }) as string },
    { value: 'queuing', name: DOC_INDEX_STATUS_MAP.queuing.text },
    { value: 'indexing', name: DOC_INDEX_STATUS_MAP.indexing.text },
    { value: 'paused', name: DOC_INDEX_STATUS_MAP.paused.text },
    { value: 'error', name: DOC_INDEX_STATUS_MAP.error.text },
    { value: 'available', name: DOC_INDEX_STATUS_MAP.available.text },
    { value: 'enabled', name: DOC_INDEX_STATUS_MAP.enabled.text },
    { value: 'disabled', name: DOC_INDEX_STATUS_MAP.disabled.text },
    { value: 'archived', name: DOC_INDEX_STATUS_MAP.archived.text },
  ], [DOC_INDEX_STATUS_MAP, t])

  const sortItems: Item[] = useMemo(() => [
    { value: 'created_at', name: t('list.sort.uploadTime', { ns: 'datasetDocuments' }) as string },
    { value: 'hit_count', name: t('list.sort.hitCount', { ns: 'datasetDocuments' }) as string },
  ], [t])

  // Determine add button text based on data source type
  const addButtonText = useMemo(() => {
    if (isDataSourceNotion)
      return t('list.addPages', { ns: 'datasetDocuments' })
    if (isDataSourceWeb)
      return t('list.addUrl', { ns: 'datasetDocuments' })
    return t('list.addFile', { ns: 'datasetDocuments' })
  }, [isDataSourceNotion, isDataSourceWeb, t])

  return (
    <>
      {/* Title section */}
      <div className="flex flex-col justify-center gap-1 px-6 pt-4">
        <h1 className="text-base font-semibold text-text-primary">
          {t('list.title', { ns: 'datasetDocuments' })}
        </h1>
        <div className="flex items-center space-x-0.5 text-sm font-normal text-text-tertiary">
          <span>{t('list.desc', { ns: 'datasetDocuments' })}</span>
          <a
            className="flex items-center text-text-accent"
            target="_blank"
            rel="noopener noreferrer"
            href={docLink('/use-dify/knowledge/integrate-knowledge-within-application')}
          >
            <span>{t('list.learnMore', { ns: 'datasetDocuments' })}</span>
            <RiExternalLinkLine className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Toolbar section */}
      <div className="flex flex-wrap items-center justify-between px-6 pt-4">
        {/* Left: Filters */}
        <div className="flex items-center gap-2">
          <Chip
            className="w-[160px]"
            showLeftIcon={false}
            value={statusFilterValue}
            items={statusFilterItems}
            onSelect={item => onStatusFilterChange(item?.value ? String(item.value) : '')}
            onClear={onStatusFilterClear}
          />
          <Input
            showLeftIcon
            showClearIcon
            wrapperClassName="!w-[200px]"
            value={inputValue}
            onChange={e => onInputChange(e.target.value)}
            onClear={() => onInputChange('')}
          />
          <div className="h-3.5 w-px bg-divider-regular"></div>
          <Sort
            order={sortValue.startsWith('-') ? '-' : ''}
            value={sortValue.replace('-', '')}
            items={sortItems}
            onSelect={value => onSortChange(String(value))}
          />
        </div>

        {/* Right: Actions */}
        <div className="flex !h-8 items-center justify-center gap-2">
          {!isFreePlan && <AutoDisabledDocument datasetId={datasetId} />}
          <IndexFailed datasetId={datasetId} />
          {!embeddingAvailable && (
            <StatusWithAction
              type="warning"
              description={t('embeddingModelNotAvailable', { ns: 'dataset' })}
            />
          )}
          {embeddingAvailable && (
            <Button variant="secondary" className="shrink-0" onClick={showEditMetadataModal}>
              <RiDraftLine className="mr-1 size-4" />
              {t('metadata.metadata', { ns: 'dataset' })}
            </Button>
          )}
          {isShowEditMetadataModal && (
            <DatasetMetadataDrawer
              userMetadata={datasetMetaData ?? []}
              onClose={hideEditMetadataModal}
              onAdd={onAddMetaData}
              onRename={onRenameMetaData}
              onRemove={onDeleteMetaData}
              builtInMetadata={builtInMetaData ?? []}
              isBuiltInEnabled={builtInEnabled}
              onIsBuiltInEnabledChange={onBuiltInEnabledChange}
            />
          )}
          {embeddingAvailable && (
            <Button variant="primary" onClick={onAddDocument} className="shrink-0">
              <PlusIcon className="mr-2 h-4 w-4 stroke-current" />
              {addButtonText}
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

export default DocumentsHeader
