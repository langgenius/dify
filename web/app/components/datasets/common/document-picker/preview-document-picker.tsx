'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import { RiArrowDownSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import FileIcon from '../document-file-icon'
import DocumentList from './document-list'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'
import Loading from '@/app/components/base/loading'
import type { DocumentItem } from '@/models/datasets'

type Props = {
  className?: string
  value: DocumentItem
  files: DocumentItem[]
  onChange: (value: DocumentItem) => void
}

const PreviewDocumentPicker: FC<Props> = ({
  className,
  value,
  files,
  onChange,
}) => {
  const { t } = useTranslation()
  const { name, extension } = value

  const [open, {
    set: setOpen,
    toggle: togglePopup,
  }] = useBoolean(false)
  const ArrowIcon = RiArrowDownSLine

  const handleChange = useCallback((item: DocumentItem) => {
    onChange(item)
    setOpen(false)
  }, [onChange, setOpen])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={togglePopup}>
        <div className={cn('flex items-center h-6 px-1 rounded-md hover:bg-state-base-hover select-none', open && 'bg-state-base-hover', className)}>
          <FileIcon name={name} extension={extension} size='md' />
          <div className='flex flex-col items-start ml-1'>
            <div className='flex items-center space-x-0.5'>
              <span className={cn('system-md-semibold max-w-[200px] truncate text-text-primary')}> {name || '--'}</span>
              <ArrowIcon className={'h-[18px] w-[18px] text-text-primary'} />
            </div>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[392px] p-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]'>
          {files?.length > 1 && <div className='pl-2 flex items-center h-8 system-xs-medium-uppercase text-text-tertiary'>{t('dataset.preprocessDocument', { num: files.length })}</div>}
          {files?.length > 0
            ? (
              <DocumentList
                list={files}
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
export default React.memo(PreviewDocumentPicker)
