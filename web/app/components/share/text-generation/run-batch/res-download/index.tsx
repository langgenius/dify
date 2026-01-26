'use client'
import type { FC } from 'react'
import { RiDownloadLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCSVDownloader,
} from 'react-papaparse'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import { cn } from '@/utils/classnames'

export type IResDownloadProps = {
  isMobile: boolean
  values: Record<string, string>[]
}

const ResDownload: FC<IResDownloadProps> = ({
  isMobile,
  values,
}) => {
  const { t } = useTranslation()
  const { CSVDownloader, Type } = useCSVDownloader()

  return (
    <CSVDownloader
      className="block cursor-pointer"
      type={Type.Link}
      filename="result"
      bom={true}
      config={{
        // delimiter: ';',
      }}
      data={values}
    >
      {isMobile && (
        <ActionButton>
          <RiDownloadLine className="h-4 w-4" />
        </ActionButton>
      )}
      {!isMobile && (
        <Button className={cn('space-x-1')}>
          <RiDownloadLine className="h-4 w-4" />
          <span>{t('operation.download', { ns: 'common' })}</span>
        </Button>
      )}
    </CSVDownloader>
  )
}
export default React.memo(ResDownload)
