'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  useCSVReader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
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
            className={cn(s.zone, zoneHover && s.zoneHover, acceptedFile ? 'px-6' : 'justify-center border-dashed text-gray-500')}
          >
            {
              acceptedFile
                ? (
                  <div className='w-full flex items-center space-x-2'>
                    <CSVIcon className="shrink-0" />
                    <div className='flex w-0 grow'>
                      <span className='max-w-[calc(100%_-_30px)] text-ellipsis whitespace-nowrap overflow-hidden text-gray-800'>{acceptedFile.name.replace(/.csv$/, '')}</span>
                      <span className='shrink-0 text-gray-500'>.csv</span>
                    </div>
                  </div>
                )
                : (
                  <div className='flex items-center justify-center space-x-2'>
                    <CSVIcon className="shrink-0" />
                    <div className='text-gray-500'>{t('share.generation.csvUploadTitle')}<span className='text-primary-400'>{t('share.generation.browse')}</span></div>
                  </div>
                )}
          </div>
        </>
      )}
    </CSVReader>
  )
}

export default React.memo(CSVReader)
