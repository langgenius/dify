'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  useCSVReader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { Csv as CSVIcon } from '@/app/components/base/icons/src/public/files'

export type Props = {
  onParsed: (data: string[][]) => void
}

const CSVReader: FC<Props> = ({
  onParsed,
}) => {
  const { t } = useTranslation()
  const { CSVReader } = useCSVReader()
  const [zoneHover, setZoneHover] = useState(false)
  return (
    <CSVReader
      onUploadAccepted={(results: any) => {
        onParsed(results.data)
        setZoneHover(false)
      }}
      onDragOver={(event: DragEvent) => {
        event.preventDefault()
        setZoneHover(true)
      }}
      onDragLeave={(event: DragEvent) => {
        event.preventDefault()
        setZoneHover(false)
      }}
    >
      {({
        getRootProps,
        acceptedFile,
      }: any) => (
        <>
          <div
            {...getRootProps()}
            className={cn(
              'flex items-center h-20 rounded-xl bg-components-dropzone-bg border border-dashed border-components-dropzone-border system-sm-regular',
              acceptedFile && 'px-6 bg-components-panel-on-panel-item-bg border-solid border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:border-components-panel-bg-blur',
              zoneHover && 'bg-components-dropzone-bg-accent border border-components-dropzone-border-accent',
            )}
          >
            {
              acceptedFile
                ? (
                  <div className='w-full flex items-center space-x-2'>
                    <CSVIcon className="shrink-0" />
                    <div className='flex w-0 grow'>
                      <span className='max-w-[calc(100%_-_30px)] truncate text-text-secondary'>{acceptedFile.name.replace(/.csv$/, '')}</span>
                      <span className='shrink-0 text-text-tertiary'>.csv</span>
                    </div>
                  </div>
                )
                : (
                  <div className='w-full flex items-center justify-center space-x-2'>
                    <CSVIcon className="shrink-0" />
                    <div className='text-text-tertiary'>{t('share.generation.csvUploadTitle')}<span className='text-text-accent cursor-pointer'>{t('share.generation.browse')}</span></div>
                  </div>
                )}
          </div>
        </>
      )}
    </CSVReader>
  )
}

export default React.memo(CSVReader)
