'use client'
import type { FC } from 'react'
import type { DocumentItem, ParentMode, SimpleDocumentDetail } from '@/models/datasets'
import { RiArrowDownSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GeneralChunk, ParentChildChunk } from '@/app/components/base/icons/src/vender/knowledge'
import Loading from '@/app/components/base/loading'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import SearchInput from '@/app/components/base/search-input'
import { ChunkingMode } from '@/models/datasets'
import { useDocumentList } from '@/service/knowledge/use-document'
import { cn } from '@/utils/classnames'
import FileIcon from '../document-file-icon'
import DocumentList from './document-list'

type Props = {
  datasetId: string
  value: {
    name?: string
    extension?: string
    chunkingMode?: ChunkingMode
    parentMode?: ParentMode
  }
  onChange: (value: SimpleDocumentDetail) => void
}

const DocumentPicker: FC<Props> = ({
  datasetId,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const {
    name,
    extension,
    chunkingMode,
    parentMode,
  } = value
  const [query, setQuery] = useState('')

  const { data } = useDocumentList({
    datasetId,
    query: {
      keyword: query,
      page: 1,
      limit: 20,
    },
  })
  const documentsList = data?.data
  const isGeneralMode = chunkingMode === ChunkingMode.text
  const isParentChild = chunkingMode === ChunkingMode.parentChild
  const isQAMode = chunkingMode === ChunkingMode.qa
  const TypeIcon = isParentChild ? ParentChildChunk : GeneralChunk

  const [open, {
    set: setOpen,
    toggle: togglePopup,
  }] = useBoolean(false)
  const ArrowIcon = RiArrowDownSLine

  const handleChange = useCallback(({ id }: DocumentItem) => {
    onChange(documentsList?.find(item => item.id === id) as SimpleDocumentDetail)
    setOpen(false)
  }, [documentsList, onChange, setOpen])

  const parentModeLabel = useMemo(() => {
    if (!parentMode)
      return '--'
    return parentMode === 'paragraph' ? t('parentMode.paragraph', { ns: 'dataset' }) : t('parentMode.fullDoc', { ns: 'dataset' })
  }, [parentMode, t])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
    >
      <PortalToFollowElemTrigger onClick={togglePopup}>
        <div className={cn('ml-1 flex cursor-pointer select-none items-center rounded-lg px-2 py-0.5 hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
          <FileIcon name={name} extension={extension} size="xl" />
          <div className="ml-1 mr-0.5 flex flex-col items-start">
            <div className="flex items-center space-x-0.5">
              <span className={cn('system-md-semibold text-text-primary')}>
                {' '}
                {name || '--'}
              </span>
              <ArrowIcon className="h-4 w-4 text-text-primary" />
            </div>
            <div className="flex h-3 items-center space-x-0.5 text-text-tertiary">
              <TypeIcon className="h-3 w-3" />
              <span className={cn('system-2xs-medium-uppercase', isParentChild && 'mt-0.5' /* to icon problem cause not ver align */)}>
                {isGeneralMode && t('chunkingMode.general', { ns: 'dataset' })}
                {isQAMode && t('chunkingMode.qa', { ns: 'dataset' })}
                {isParentChild && `${t('chunkingMode.parentChild', { ns: 'dataset' })} · ${parentModeLabel}`}
              </span>
            </div>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
        <div className="w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 pt-2 shadow-lg backdrop-blur-[5px]">
          <SearchInput value={query} onChange={setQuery} className="mx-1" />
          {documentsList
            ? (
                <DocumentList
                  className="mt-2"
                  list={documentsList.map(d => ({
                    id: d.id,
                    name: d.name,
                    extension: d.data_source_detail_dict?.upload_file?.extension || '',
                  }))}
                  onChange={handleChange}
                />
              )
            : (
                <div className="mt-2 flex h-[100px] w-[360px] items-center justify-center">
                  <Loading />
                </div>
              )}
        </div>

      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(DocumentPicker)
