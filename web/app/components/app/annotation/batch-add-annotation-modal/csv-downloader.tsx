'use client'
import type { FC } from 'react'
import React from 'react'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'

const CSV_TEMPLATE_QA_EN = [
  ['question', 'answer'],
  ['question1', 'answer1'],
  ['question2', 'answer2'],
]
const CSV_TEMPLATE_QA_CN = [
  ['问题', '答案'],
  ['问题 1', '答案 1'],
  ['问题 2', '答案 2'],
]

const CSVDownload: FC = () => {
  const { t } = useTranslation()

  const { locale } = useContext(I18n)
  const { CSVDownloader, Type } = useCSVDownloader()

  const getTemplate = () => {
    return locale !== LanguagesSupported[1] ? CSV_TEMPLATE_QA_EN : CSV_TEMPLATE_QA_CN
  }

  return (
    <div className='mt-6'>
      <div className='system-sm-medium text-text-primary'>{t('share.generation.csvStructureTitle')}</div>
      <div className='mt-2 max-h-[500px] overflow-auto'>
        <table className='table-fixed w-full border-separate border-spacing-0 border border-divider-regular rounded-lg text-xs'>
          <thead className='text-text-tertiary'>
            <tr>
              <td className='h-9 pl-3 pr-2 border-b border-divider-regular'>{t('appAnnotation.batchModal.question')}</td>
              <td className='h-9 pl-3 pr-2 border-b border-divider-regular'>{t('appAnnotation.batchModal.answer')}</td>
            </tr>
          </thead>
          <tbody className='text-gray-700'>
            <tr>
              <td className='h-9 pl-3 pr-2 border-b border-divider-subtle text-[13px]'>{t('appAnnotation.batchModal.question')} 1</td>
              <td className='h-9 pl-3 pr-2 border-b border-divider-subtle text-[13px]'>{t('appAnnotation.batchModal.answer')} 1</td>
            </tr>
            <tr>
              <td className='h-9 pl-3 pr-2 text-[13px]'>{t('appAnnotation.batchModal.question')} 2</td>
              <td className='h-9 pl-3 pr-2 text-[13px]'>{t('appAnnotation.batchModal.answer')} 2</td>
            </tr>
          </tbody>
        </table>
      </div>
      <CSVDownloader
        className="block mt-2 cursor-pointer"
        type={Type.Link}
        filename={`template-${locale}`}
        bom={true}
        data={getTemplate()}
      >
        <div className='flex items-center h-[18px] space-x-1 text-text-accent system-xs-medium'>
          <DownloadIcon className='w-3 h-3 mr-1' />
          {t('appAnnotation.batchModal.template')}
        </div>
      </CSVDownloader>
    </div>

  )
}
export default React.memo(CSVDownload)
