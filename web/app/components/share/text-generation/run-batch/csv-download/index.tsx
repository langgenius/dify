'use client'
import type { FC } from 'react'
import React from 'react'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'

export type ICSVDownloadProps = {
  vars: { name: string }[]
}

const CSVDownload: FC<ICSVDownloadProps> = ({
  vars,
}) => {
  const { t } = useTranslation()

  const { CSVDownloader, Type } = useCSVDownloader()
  const template = (() => {
    const res: Record<string, string> = {}
    vars.forEach((item) => {
      res[item.name] = ''
    })
    console.log(res)
    return res
  })()
  // debugger
  return (
    <CSVDownloader
      className="block mt-2 cursor-pointer"
      type={Type.Link}
      filename={'template'}
      bom={true}
      config={{
        delimiter: ';',
      }}
      data={[
        template,
      ]}
    >
      <div className='flex items-center h-[18px] space-x-1 text-[#155EEF] text-xs font-medium'>
        <DownloadIcon className='w-3 h-3' />
        <span>{t('share.generation.downloadTemplate')}</span>
      </div>
    </CSVDownloader>
  )
}
export default React.memo(CSVDownload)
