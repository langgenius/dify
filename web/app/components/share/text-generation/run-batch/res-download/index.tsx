'use client'
import type { FC } from 'react'
import React from 'react'
import { RiDownloadLine } from '@remixicon/react'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

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
      filename={'result'}
      bom={true}
      config={{
        // delimiter: ';',
      }}
      data={values}
    >
      {isMobile && (
        <ActionButton>
          <RiDownloadLine className='w-4 h-4' />
        </ActionButton>
      )}
      {!isMobile && (
        <Button className={cn('space-x-1')}>
          <RiDownloadLine className='w-4 h-4' />
          <span>{t('common.operation.download')}</span>
        </Button>
      )}
    </CSVDownloader>
  )
}
export default React.memo(ResDownload)
