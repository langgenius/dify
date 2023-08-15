'use client'
import type { FC } from 'react'
import React from 'react'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'

const CSV_TEMPLATE = [
  ['content/question', 'answer(Only need with QA model)'],
  ['content/question1', 'answer1'],
  ['content/question2', 'answer2'],
]

const CSVDownload: FC = () => {
  const { t } = useTranslation()
  const { CSVDownloader, Type } = useCSVDownloader()

  return (
    <div className='mt-6'>
      <div className='text-sm text-gray-900 font-medium'>{t('share.generation.csvStructureTitle')}</div>
      <div className='mt-2 max-h-[500px] overflow-auto'>
        <table className='table-fixed w-full border-separate border-spacing-0 border border-gray-200 rounded-lg text-xs'>
          <thead className='text-gray-500'>
            <tr>
              <td className='h-9 pl-3 pr-2 border-b border-gray-200'>{t('datasetDocuments.list.batchModal.question')}</td>
              <td className='h-9 pl-3 pr-2 border-b border-gray-200'>{t('datasetDocuments.list.batchModal.answer')}</td>
            </tr>
          </thead>
          <tbody className='text-gray-700'>
            <tr>
              <td className='h-9 pl-3 pr-2 border-b border-gray-100 text-[13px]'>{t('datasetDocuments.list.batchModal.question')} 1</td>
              <td className='h-9 pl-3 pr-2 border-b border-gray-100 text-[13px]'>{t('datasetDocuments.list.batchModal.answer')} 1</td>
            </tr>
            <tr>
              <td className='h-9 pl-3 pr-2 text-[13px]'>{t('datasetDocuments.list.batchModal.question')} 2</td>
              <td className='h-9 pl-3 pr-2 text-[13px]'>{t('datasetDocuments.list.batchModal.answer')} 2</td>
            </tr>
          </tbody>
        </table>
      </div>
      <CSVDownloader
        className="block mt-2 cursor-pointer"
        type={Type.Link}
        filename={'template'}
        bom={true}
        data={CSV_TEMPLATE}
      >
        <div className='flex items-center h-[18px] space-x-1 text-[#155EEF] text-xs font-medium'>
          <DownloadIcon className='w-3 h-3' />
          {t('datasetDocuments.list.batchModal.template')}
        </div>
      </CSVDownloader>
    </div>

  )
}
export default React.memo(CSVDownload)
