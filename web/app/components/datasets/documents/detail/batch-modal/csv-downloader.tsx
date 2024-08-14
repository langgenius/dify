'use client'
import type { FC } from 'react'
import React from 'react'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'
import { DocForm } from '@/models/datasets'
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
const CSV_TEMPLATE_EN = [
  ['segment content'],
  ['content1'],
  ['content2'],
]
const CSV_TEMPLATE_CN = [
  ['分段内容'],
  ['内容 1'],
  ['内容 2'],
]

const CSVDownload: FC<{ docForm: DocForm }> = ({ docForm }) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const { CSVDownloader, Type } = useCSVDownloader()

  const getTemplate = () => {
    if (locale === LanguagesSupported[1]) {
      if (docForm === DocForm.QA)
        return CSV_TEMPLATE_QA_CN
      return CSV_TEMPLATE_CN
    }
    if (docForm === DocForm.QA)
      return CSV_TEMPLATE_QA_EN
    return CSV_TEMPLATE_EN
  }

  return (
    <div className='mt-6'>
      <div className='text-sm text-gray-900 font-medium'>{t('share.generation.csvStructureTitle')}</div>
      <div className='mt-2 max-h-[500px] overflow-auto'>
        {docForm === DocForm.QA && (
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
        )}
        {docForm === DocForm.TEXT && (
          <table className='table-fixed w-full border-separate border-spacing-0 border border-gray-200 rounded-lg text-xs'>
            <thead className='text-gray-500'>
              <tr>
                <td className='h-9 pl-3 pr-2 border-b border-gray-200'>{t('datasetDocuments.list.batchModal.contentTitle')}</td>
              </tr>
            </thead>
            <tbody className='text-gray-700'>
              <tr>
                <td className='h-9 pl-3 pr-2 border-b border-gray-100 text-[13px]'>{t('datasetDocuments.list.batchModal.content')} 1</td>
              </tr>
              <tr>
                <td className='h-9 pl-3 pr-2 text-[13px]'>{t('datasetDocuments.list.batchModal.content')} 2</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <CSVDownloader
        className="block mt-2 cursor-pointer"
        type={Type.Link}
        filename={'template'}
        bom={true}
        data={getTemplate()}
      >
        <div className='flex items-center h-[18px] space-x-1 text-[#155EEF] text-xs font-medium'>
          <DownloadIcon className='w-3 h-3 mr-1' />
          {t('datasetDocuments.list.batchModal.template')}
        </div>
      </CSVDownloader>
    </div>

  )
}
export default React.memo(CSVDownload)
