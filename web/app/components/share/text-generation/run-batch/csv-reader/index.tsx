'use client'
import type { ParseResult } from 'papaparse'
import type { FC } from 'react'
import jschardet from 'jschardet'
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
        if (!file) {
          onParsed(results.data)
          setZoneHover(false)
          return
        }

        const buffer = await file.arrayBuffer()
        // jschardet requires a buffer or a string of bytes
        const uint8Array = new Uint8Array(buffer)
        // jschardet.detect accepts string | Buffer, convert to string for browser compatibility
        const detected = jschardet.detect(uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), ''))

        let encoding = detected.encoding
        // jschardet can sometimes misidentify GBK as 'windows-1252'.
        // This is a heuristic to handle such cases.
        if (encoding === 'windows-1252' || encoding === 'ISO-8859-2') {
          encoding = 'GBK'
        }

        // Use UTF-8 as a fallback for unsupported or uncertain encodings.
        const supportedEncodings = ['UTF-8', 'GBK', 'GB18030', 'BIG5']
        if (!encoding || !supportedEncodings.includes(encoding.toUpperCase())) {
          encoding = 'UTF-8'
        }

        const text = new TextDecoder(encoding, { fatal: false }).decode(buffer)

        parse(text, {
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
