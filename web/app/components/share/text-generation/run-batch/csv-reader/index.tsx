'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Csv as CSVIcon } from '@/app/components/base/icons/src/public/files'
import { cn } from '@/utils/classnames'
import { parseCSV } from '@/utils/csv'

export type Props = {
  onParsed: (data: string[][]) => void
}

const CSVReader: FC<Props> = ({
  onParsed,
}) => {
  const { t } = useTranslation()
  const [zoneHover, setZoneHover] = useState(false)
  const [acceptedFile, setAcceptedFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setAcceptedFile(file)
    const results = await parseCSV(file)
    onParsed(results.data)
  }, [onParsed])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setZoneHover(false)
    const file = event.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv'))
      handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setZoneHover(true)
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setZoneHover(false)
  }, [])

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file)
      handleFile(file)
  }, [handleFile])

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleInputChange}
      />
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'system-sm-regular flex h-20 cursor-pointer items-center rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg',
          acceptedFile && 'border-solid border-components-panel-border bg-components-panel-on-panel-item-bg px-6 hover:border-components-panel-bg-blur hover:bg-components-panel-on-panel-item-bg-hover',
          zoneHover && 'border border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
        )}
      >
        {
          acceptedFile
            ? (
                <div className="flex w-full items-center space-x-2">
                  <CSVIcon className="shrink-0" />
                  <div className="flex w-0 grow">
                    <span className="max-w-[calc(100%_-_30px)] truncate text-text-secondary">{acceptedFile.name.replace(/.csv$/, '')}</span>
                    <span className="shrink-0 text-text-tertiary">.csv</span>
                  </div>
                </div>
              )
            : (
                <div className="flex w-full items-center justify-center space-x-2">
                  <CSVIcon className="shrink-0" />
                  <div className="text-text-tertiary">
                    {t('generation.csvUploadTitle', { ns: 'share' })}
                    <span className="cursor-pointer text-text-accent">{t('generation.browse', { ns: 'share' })}</span>
                  </div>
                </div>
              )
        }
      </div>
    </>
  )
}

export default React.memo(CSVReader)
