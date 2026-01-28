'use client'
import type { FC } from 'react'
import type { DocumentItem } from '@/models/datasets'
import { RiArrowDownSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import FileIcon from '../document-file-icon'
import DocumentList from './document-list'

type Props = {
  className?: string
  value?: DocumentItem
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
  const name = value?.name || ''
  const extension = value?.extension

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
      placement="bottom-start"
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={togglePopup}>
        <div className={cn('flex h-6 select-none items-center rounded-md px-1 hover:bg-state-base-hover', open && 'bg-state-base-hover', className)}>
          <FileIcon name={name} extension={extension} size="lg" />
          <div className="ml-1 flex flex-col items-start">
            <div className="flex items-center space-x-0.5">
              <span className={cn('system-md-semibold max-w-[200px] truncate text-text-primary')}>
                {' '}
                {name || '--'}
              </span>
              <ArrowIcon className="h-[18px] w-[18px] text-text-primary" />
            </div>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
        <div className="w-[392px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
          {files?.length > 1 && <div className="system-xs-medium-uppercase flex h-8 items-center pl-2 text-text-tertiary">{t('preprocessDocument', { ns: 'dataset', num: files.length })}</div>}
          {files?.length > 0
            ? (
                <DocumentList
                  list={files}
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
export default React.memo(PreviewDocumentPicker)
