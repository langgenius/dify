'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ComboboxChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { ParentMode } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
} from '@langgenius/dify-ui/combobox'
import { SpinnerIcon } from '@langgenius/dify-ui/spinner'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getUploadFileExtension } from '@/app/components/datasets/documents/document-source'
import { ChunkingMode } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import FileIcon from '../document-file-icon'
import DocumentList from './document-list'

// The list query and the document detail query both describe the picked document.
export type PickerDocument = Pick<
  DocumentWithSegmentsResponse,
  'id' | 'doc_form' | 'data_source_info'
> & {
  name?: string | null
  data_source_detail_dict?: DocumentWithSegmentsResponse['data_source_detail_dict'] | null
}

type Props = Readonly<{
  datasetId: string
  value?: PickerDocument | null
  parentMode?: ParentMode
  onChange: (value: PickerDocument) => void
}>

function getDocumentLabel(document: PickerDocument) {
  return document.name ?? ''
}

function getDocumentValue(document: PickerDocument) {
  return document.id
}

function isSameDocument(item: PickerDocument, value: PickerDocument) {
  return item.id === value.id
}

function getDocumentExtension(document?: PickerDocument | null) {
  if (!document) return ''

  const detailExtension = document.data_source_detail_dict?.upload_file?.extension
  if (detailExtension) return detailExtension

  return getUploadFileExtension(document.data_source_info) ?? ''
}

function DocumentPickerTriggerValue({
  document,
  parentMode,
}: {
  document?: PickerDocument | null
  parentMode?: ParentMode
}) {
  const { t } = useTranslation(['dataset'])
  const isGeneralMode = document?.doc_form === ChunkingMode.text
  const isParentChild = document?.doc_form === ChunkingMode.parentChild
  const isQAMode = document?.doc_form === ChunkingMode.qa
  const parentModeLabel = (() => {
    if (!parentMode) return '--'
    return parentMode === 'paragraph'
      ? t(($) => $['parentMode.paragraph'], { ns: 'dataset' })
      : t(($) => $['parentMode.fullDoc'], { ns: 'dataset' })
  })()

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <FileIcon
        name={document?.name ?? undefined}
        extension={getDocumentExtension(document)}
        size="xl"
      />
      <span className="flex min-w-0 flex-col items-start">
        <span className="flex max-w-full min-w-0 items-center gap-1">
          <span className="max-w-70 min-w-0 truncate system-md-semibold text-text-primary">
            {document?.name || '--'}
          </span>
          <span
            className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-primary"
            aria-hidden="true"
          />
        </span>
        <span className="flex h-3 max-w-75 items-center gap-0.5 text-text-tertiary">
          <span
            className={cn(
              'size-3 shrink-0',
              isParentChild
                ? 'i-custom-vender-knowledge-parent-child-chunk'
                : 'i-custom-vender-knowledge-general-chunk',
            )}
            aria-hidden="true"
          />
          <span className={cn('truncate system-2xs-medium-uppercase', isParentChild && 'mt-0.5')}>
            {isGeneralMode && t(($) => $['chunkingMode.general'], { ns: 'dataset' })}
            {isQAMode && t(($) => $['chunkingMode.qa'], { ns: 'dataset' })}
            {isParentChild &&
              `${t(($) => $['chunkingMode.parentChild'], { ns: 'dataset' })} · ${parentModeLabel}`}
          </span>
        </span>
      </span>
    </span>
  )
}

export function DocumentPicker({ datasetId, value, parentMode, onChange }: Props) {
  const { t } = useTranslation(['common'])
  const [searchValue, setSearchValue] = useState('')
  const debouncedSearchValue = useDebounce(searchValue, { wait: 500 })

  const { data } = useQuery(
    consoleQuery.datasets.byDatasetId.documents.get.queryOptions({
      input: {
        params: { dataset_id: datasetId },
        query: { keyword: debouncedSearchValue, page: 1, limit: 20 },
      },
      placeholderData: keepPreviousData,
    }),
  )
  const documentsList = data?.data ?? []

  const handleInputValueChange = (inputValue: string, details: ComboboxChangeEventDetails) => {
    if (details.reason !== 'item-press') setSearchValue(inputValue)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setSearchValue('')
  }

  const handleDocumentChange = (document: PickerDocument | null) => {
    if (!document) return

    onChange(document)
    setSearchValue('')
  }

  return (
    <Combobox<PickerDocument>
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
        aria-label={value?.name || t(($) => $['operation.search'], { ns: 'common' })}
        className="ml-1 flex min-w-0 items-center gap-0.5 rounded-lg px-2 py-1 text-start transition-colors hover:bg-state-base-hover focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover motion-reduce:transition-none"
      >
        <ComboboxValue<PickerDocument>>
          {(document) => <DocumentPickerTriggerValue document={document} parentMode={parentMode} />}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPortal>
        <ComboboxPositioner side="bottom" align="start" sideOffset={0}>
          <ComboboxPopup
            aria-label={t(($) => $['operation.search'], { ns: 'common' })}
            className="w-90 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]"
          >
            <ComboboxInputGroup>
              <span
                className="i-ri-search-line size-4 shrink-0 text-text-tertiary"
                aria-hidden="true"
              />
              <ComboboxInput
                aria-label={t(($) => $['operation.search'], { ns: 'common' })}
                placeholder={t(($) => $['operation.search'], { ns: 'common' })}
              />
            </ComboboxInputGroup>
            <DocumentList />
            <ComboboxEmpty className="p-0">
              {data && (
                <div className="mt-2 flex h-25 w-full items-center justify-center px-3 py-2 system-sm-regular text-text-tertiary">
                  {t(($) => $.noData, { ns: 'common' })}
                </div>
              )}
            </ComboboxEmpty>
            <ComboboxStatus
              className={cn(!data ? 'mt-2 flex h-25 w-full items-center justify-center' : 'h-0')}
            >
              {!data && (
                <>
                  <span className="sr-only">{t(($) => $.loading, { ns: 'common' })}</span>
                  <div className="flex w-full justify-center" aria-hidden="true">
                    <SpinnerIcon />
                  </div>
                </>
              )}
            </ComboboxStatus>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}
