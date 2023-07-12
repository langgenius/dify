'use client'
import type { FC } from 'react'
import React from 'react'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'
import Button from '@/app/components/base/button'
export type IResDownloadProps = {
  isMobile: boolean
  vars: { name: string }[]
  values: string[][]
}

const ResDownload: FC<IResDownloadProps> = ({
  isMobile,
  vars,
  values,
}) => {
  const { t } = useTranslation()
  const { CSVDownloader, Type } = useCSVDownloader()
  const addQueryContentVars = [
    ...vars,
    { name: t('share.generation.queryTitle') },
    { name: 'Result' },
  ]
  const headers = (() => {
    const res: Record<string, string> = {}
    addQueryContentVars.forEach((item) => {
      res[item.name] = ''
    })
    return res
  })()
  return (
    <CSVDownloader
      className="block cursor-pointer"
      type={Type.Link}
      filename={'template'}
      bom={true}
      config={{
        // delimiter: ';',
      }}
      data={[
        headers,
        ...values,
      ]}
    >
      <Button className={cn('flex items-center !h-8 space-x-2 bg-white !text-[13px] font-medium', isMobile ? '!p-0 !w-8 justify-center' : '!px-3')}>
        <DownloadIcon className='w-4 h-4 text-[#155EEF]' />
        {!isMobile && <span className='text-[#155EEF]'>{t('common.operation.download')}</span>}
      </Button>
    </CSVDownloader>
  )
}
export default React.memo(ResDownload)
