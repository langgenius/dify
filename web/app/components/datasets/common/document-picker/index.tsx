'use client'
import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { ParentMode, SimpleDocumentDetail } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
} from '@langgenius/dify-ui/combobox'
import { RiArrowDownSLine } from '@remixicon/react'
import { useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GeneralChunk, ParentChildChunk } from '@/app/components/base/icons/src/vender/knowledge'
import Loading from '@/app/components/base/loading'
import { ChunkingMode } from '@/models/datasets'
import { useDocumentList } from '@/service/knowledge/use-document'
import FileIcon from '../document-file-icon'
import DocumentList from './document-list'

type Props = {
  datasetId: string
  value?: SimpleDocumentDetail | null
  parentMode?: ParentMode
  onChange: (value: SimpleDocumentDetail) => void
}

function getDocumentLabel(document: SimpleDocumentDetail) {
  return document.name
}

function getDocumentValue(document: SimpleDocumentDetail) {
  return document.id
}

function isSameDocument(item: SimpleDocumentDetail, value: SimpleDocumentDetail) {
  return item.id === value.id
}

function getDocumentExtension(document?: SimpleDocumentDetail | null) {
  if (!document)
    return ''

  const detailExtension = document.data_source_detail_dict?.upload_file?.extension
  if (detailExtension)
    return detailExtension

  const dataSourceInfo = document.data_source_info
  if (dataSourceInfo && 'upload_file' in dataSourceInfo)
    return dataSourceInfo.upload_file.extension

  return ''
}

function DocumentPickerTriggerValue({
  document,
  parentMode,
}: {
  document?: SimpleDocumentDetail | null
  parentMode?: ParentMode
}) {
  const { t } = useTranslation()
  const isGeneralMode = document?.doc_form === ChunkingMode.text
  const isParentChild = document?.doc_form === ChunkingMode.parentChild
  const isQAMode = document?.doc_form === ChunkingMode.qa
  const TypeIcon = isParentChild ? ParentChildChunk : GeneralChunk
  const ArrowIcon = RiArrowDownSLine
  const parentModeLabel = (() => {
    if (!parentMode)
      return '--'
    return parentMode === 'paragraph' ? t('parentMode.paragraph', { ns: 'dataset' }) : t('parentMode.fullDoc', { ns: 'dataset' })
  })()

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <FileIcon name={document?.name} extension={getDocumentExtension(document)} size="xl" />
      <span className="flex min-w-0 flex-col items-start">
        <span className="flex max-w-full min-w-0 items-center gap-1">
          <span className="max-w-[280px] min-w-0 truncate system-md-semibold text-text-primary">
            {document?.name || '--'}
          </span>
          <ArrowIcon className="h-4 w-4 shrink-0 text-text-primary" aria-hidden="true" />
        </span>
        <span className="flex h-3 max-w-[300px] items-center gap-0.5 text-text-tertiary">
          <TypeIcon className="h-3 w-3 shrink-0" />
          <span className={cn('truncate system-2xs-medium-uppercase', isParentChild && 'mt-0.5')}>
            {isGeneralMode && t('chunkingMode.general', { ns: 'dataset' })}
            {isQAMode && t('chunkingMode.qa', { ns: 'dataset' })}
            {isParentChild && `${t('chunkingMode.parentChild', { ns: 'dataset' })} · ${parentModeLabel}`}
          </span>
        </span>
      </span>
    </span>
  )
}

export function DocumentPicker({
  datasetId,
  value,
  parentMode,
  onChange,
}: Props) {
  const { t } = useTranslation()
  const [searchValue, setSearchValue] = useState('')
  const deferredSearchValue = useDeferredValue(searchValue)

  const { data } = useDocumentList({
    datasetId,
    query: {
      keyword: deferredSearchValue,
      page: 1,
      limit: 20,
    },
  })
  const documentsList = data?.data ?? []

  const handleInputValueChange = (inputValue: string, details: ComboboxRootChangeEventDetails) => {
    if (details.reason !== 'item-press')
      setSearchValue(inputValue)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen)
      setSearchValue('')
  }

  const handleDocumentChange = (document: SimpleDocumentDetail | null) => {
    if (!document)
      return

    onChange(document)
    setSearchValue('')
  }

  return (
    <Combobox<SimpleDocumentDetail>
      items={documentsList}
      value={value ?? null}
      inputValue={searchValue}
      onOpenChange={handleOpenChange}
      onInputValueChange={handleInputValueChange}
      onValueChange={handleDocumentChange}
      isItemEqualToValue={isSameDocument}
      itemToStringLabel={getDocumentLabel}
      itemToStringValue={getDocumentValue}
      filter={null}
    >
      <ComboboxTrigger
        aria-label={value?.name || t('operation.search', { ns: 'common' })}
        icon={false}
        className={cn(
          'ml-1 flex h-auto w-auto rounded-lg border-0 bg-transparent px-2 py-1 hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active data-open:bg-state-base-hover',
        )}
      >
        <ComboboxValue>
          {(document: SimpleDocumentDetail | null) => (
            <DocumentPickerTriggerValue document={document} parentMode={parentMode} />
          )}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent
        placement="bottom-start"
        sideOffset={0}
        popupClassName="w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg backdrop-blur-[5px]"
      >
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <span className="mr-0.5 i-ri-search-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <ComboboxInput
            aria-label={t('operation.search', { ns: 'common' })}
            placeholder={t('operation.search', { ns: 'common' })}
            className="block h-4.5 grow px-1 py-0 text-[13px] text-text-primary"
          />
        </ComboboxInputGroup>
        {data
          ? (
              documentsList.length > 0
                ? (
                    <DocumentList
                      className="mt-2"
                    />
                  )
                : (
                    <ComboboxEmpty className="mt-2 flex h-[100px] w-full items-center justify-center">
                      {t('noData', { ns: 'common' })}
                    </ComboboxEmpty>
                  )
            )
          : (
              <ComboboxStatus className="mt-2 flex h-[100px] w-full items-center justify-center">
                <Loading />
              </ComboboxStatus>
            )}
      </ComboboxContent>
    </Combobox>
  )
}
