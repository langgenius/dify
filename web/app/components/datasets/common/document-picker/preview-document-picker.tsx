'use client'
import type { FC } from 'react'
import type { DocumentItem } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import FileIcon from '../document-file-icon'

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
  }] = useBoolean(false)
  const ArrowIcon = RiArrowDownSLine

  const handleChange = useCallback((item: DocumentItem) => {
    onChange(item)
    setOpen(false)
  }, [onChange, setOpen])

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        nativeButton={false}
        render={(
          <div className={cn('flex h-6 items-center rounded-md px-1 select-none hover:bg-state-base-hover', open && 'bg-state-base-hover', className)}>
            <FileIcon name={name} extension={extension} size="lg" />
            <div className="ml-1 flex flex-col items-start">
              <div className="flex items-center space-x-0.5">
                <span className={cn('max-w-[200px] truncate system-md-semibold text-text-primary')}>
                  {' '}
                  {name || '--'}
                </span>
                <ArrowIcon className="h-[18px] w-[18px] text-text-primary" />
              </div>
            </div>
          </div>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[392px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
          {files?.length > 1 && <div className="flex h-8 items-center pl-2 system-xs-medium-uppercase text-text-tertiary">{t('preprocessDocument', { ns: 'dataset', num: files.length })}</div>}
          {files?.length > 0
            ? (
                <PreviewDocumentList
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
      </PopoverContent>
    </Popover>
  )
}
export default React.memo(PreviewDocumentPicker)

function PreviewDocumentList({
  list,
  onChange,
}: {
  list: DocumentItem[]
  onChange: (value: DocumentItem) => void
}) {
  return (
    <div className="max-h-[calc(100vh-120px)] overflow-auto">
      {list.map(item => (
        <button
          key={item.id}
          type="button"
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left hover:bg-state-base-hover"
          onClick={() => onChange(item)}
        >
          <FileIcon name={item.name} extension={item.extension} size="lg" />
          <span className="truncate text-sm text-text-secondary">{item.name}</span>
        </button>
      ))}
    </div>
  )
}
