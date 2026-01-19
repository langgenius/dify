'use client'
import type { ParseResult } from 'papaparse'
import type { FC } from 'react'
import { parse } from 'papaparse'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCSVReader,
} from 'react-papaparse'
import { Csv as CSVIcon } from '@/app/components/base/icons/src/public/files'
import { cn } from '@/utils/classnames'

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
      onUploadAccepted={async (results: any, file: File) => {
        const buffer = await file?.arrayBuffer()
        const head = await file?.slice(0, 1024).arrayBuffer()

        let encoding = 'UTF-8'

        try {
          const gbkText = new TextDecoder('GBK', { fatal: true })?.decode(head)
          const hasChinese = /[\u4E00-\u9FA5]/.test(gbkText)

          if (hasChinese) {
            encoding = 'GBK'
          }
        }
        catch (e) {
          console.error(e)
        }
        const text: string = new TextDecoder(encoding, { fatal: false }).decode(buffer)

        parse(text, {
          encoding,
          worker: true,
          complete: (results: ParseResult<string[]>) => {
            onParsed(results.data)
            setZoneHover(false)
          },
        })
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
              'system-sm-regular flex h-20 items-center rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg',
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
      )}
    </CSVReader>
  )
}

export default React.memo(CSVReader)
