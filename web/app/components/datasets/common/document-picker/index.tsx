'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ParentMode } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Menu,
  MenuContent,
  MenuFilterProvider,
  MenuInput,
  MenuInputGroup,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getUploadFileExtension } from '@/app/components/datasets/documents/document-source'
import { ChunkingMode } from '@/models/datasets'
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

type DocumentPickerProps = {
  datasetId: string
  currentDocument?: PickerDocument | null
  parentMode?: ParentMode
}

function getDocumentExtension(document?: PickerDocument | null) {
  if (!document) return ''

  const detailExtension = document.data_source_detail_dict?.upload_file?.extension
  if (detailExtension) return detailExtension

  return getUploadFileExtension(document.data_source_info) ?? ''
}

function DocumentPickerTriggerValue({
  currentDocument: document,
  parentMode,
}: Pick<DocumentPickerProps, 'currentDocument' | 'parentMode'>) {
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

export function DocumentPicker({ datasetId, currentDocument, parentMode }: DocumentPickerProps) {
  const { t } = useTranslation(['common'])
  const [searchValue, setSearchValue] = useState('')

  return (
    <MenuFilterProvider filter={null} value={searchValue} onValueChange={setSearchValue}>
      <Menu>
        <MenuTrigger
          aria-label={currentDocument?.name || t(($) => $['operation.search'], { ns: 'common' })}
          className="ms-1 flex min-w-0 items-center gap-0.5 rounded-lg px-2 py-1 text-start transition-colors hover:bg-state-base-hover focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover motion-reduce:transition-none"
        >
          <DocumentPickerTriggerValue currentDocument={currentDocument} parentMode={parentMode} />
        </MenuTrigger>
        <MenuContent
          align="start"
          sideOffset={0}
          aria-label={t(($) => $['operation.search'], { ns: 'common' })}
          className="w-90 max-w-(--available-width)"
        >
          <MenuInputGroup>
            <span
              className="i-ri-search-line size-4 shrink-0 text-text-tertiary"
              aria-hidden="true"
            />
            <MenuInput
              aria-label={t(($) => $['operation.search'], { ns: 'common' })}
              placeholder={t(($) => $['operation.search'], { ns: 'common' })}
            />
          </MenuInputGroup>
          <DocumentList
            datasetId={datasetId}
            currentDocumentId={currentDocument?.id}
            searchValue={searchValue}
          />
        </MenuContent>
      </Menu>
    </MenuFilterProvider>
  )
}
