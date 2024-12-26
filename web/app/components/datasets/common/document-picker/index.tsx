'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useBoolean } from 'ahooks'
import { RiArrowDownSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import FileIcon from '../document-file-icon'
import DocumentList from './document-list'
import type { DocumentItem, ParentMode, SimpleDocumentDetail } from '@/models/datasets'
import { ProcessMode } from '@/models/datasets'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'
import SearchInput from '@/app/components/base/search-input'
import { GeneralType, ParentChildType } from '@/app/components/base/icons/src/public/knowledge'
import { useDocumentList } from '@/service/knowledge/use-document'
import Loading from '@/app/components/base/loading'

type Props = {
  datasetId: string
  value: {
    name?: string
    extension?: string
    processMode?: ProcessMode
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
    processMode,
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
  const isParentChild = processMode === ProcessMode.parentChild
  const TypeIcon = isParentChild ? ParentChildType : GeneralType

  const [open, {
    set: setOpen,
    toggle: togglePopup,
  }] = useBoolean(false)
  const ArrowIcon = RiArrowDownSLine

  const handleChange = useCallback(({ id }: DocumentItem) => {
    onChange(documentsList?.find(item => item.id === id) as SimpleDocumentDetail)
    setOpen(false)
  }, [documentsList, onChange, setOpen])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
    >
      <PortalToFollowElemTrigger onClick={togglePopup}>
        <div className={cn('flex items-center ml-1 px-2 py-0.5 rounded-lg hover:bg-state-base-hover select-none cursor-pointer', open && 'bg-state-base-hover')}>
          <FileIcon name={name} extension={extension} size='lg' />
          <div className='flex flex-col items-start ml-1 mr-0.5'>
            <div className='flex items-center space-x-0.5'>
              <span className={cn('system-md-semibold')}> {name || '--'}</span>
              <ArrowIcon className={'h-4 w-4 text-text-primary'} />
            </div>
            <div className='flex items-center h-3 text-text-tertiary space-x-0.5'>
              <TypeIcon className='w-3 h-3' />
              <span className={cn('system-2xs-medium-uppercase', isParentChild && 'mt-0.5' /* to icon problem cause not ver align */)}>
                {isParentChild ? t('dataset.chunkingMode.parentChild') : t('dataset.chunkingMode.general')}
                {isParentChild && ` · ${!parentMode ? '--' : parentMode === 'paragraph' ? t('dataset.parentMode.paragraph') : t('dataset.parentMode.fullDoc')}`}
              </span>
            </div>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[360px] p-1 pt-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]'>
          <SearchInput value={query} onChange={setQuery} className='mx-1' />
          {documentsList
            ? (
              <DocumentList
                className='mt-2'
                list={documentsList.map(d => ({
                  id: d.id,
                  name: d.name,
                  extension: d.data_source_detail_dict?.upload_file?.extension || '',
                }))}
                onChange={handleChange}
              />
            )
            : (<div className='mt-2 flex items-center justify-center w-[360px] h-[100px]'>
              <Loading />
            </div>)}
        </div>

      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(DocumentPicker)
