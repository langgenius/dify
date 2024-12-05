'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useBoolean } from 'ahooks'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import FileIcon from '../document-file-icon'
import type { ParentMode, SimpleDocumentDetail } from '@/models/datasets'
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
  const ArrowIcon = open ? RiArrowDownSLine : RiArrowUpSLine

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
    >
      <PortalToFollowElemTrigger onClick={togglePopup}>
        <div className={cn('flex items-center ml-1 px-2 py-0.5 rounded-lg hover:bg-state-base-hover select-none', open && 'bg-state-base-hover')}>
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
                {isParentChild && ` · ${parentMode || '--'}`}
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
              <div className='mt-2'>
                {documentsList.map(item => (
                  <div
                    key={item.id}
                    className='flex items-center h-8 px-2 hover:bg-state-base-hover rounded-lg space-x-2 cursor-pointer'
                    onClick={
                      () => {
                        onChange(item)
                        setOpen(false)
                      }
                    }
                  >
                    <FileIcon name={item.name} extension={item.data_source_detail_dict?.upload_file.extension} size='sm' />
                    <div className='truncate text-text-secondary text-sm'>{item.name}</div>
                  </div>
                ))}
              </div>
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
