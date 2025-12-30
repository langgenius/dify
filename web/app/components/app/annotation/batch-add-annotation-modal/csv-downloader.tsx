'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'

import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'

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

  const locale = useLocale()
  const { CSVDownloader, Type } = useCSVDownloader()

  const getTemplate = () => {
    return locale !== LanguagesSupported[1] ? CSV_TEMPLATE_QA_EN : CSV_TEMPLATE_QA_CN
  }

  return (
    <div className="mt-6">
      <div className="system-sm-medium text-text-primary">{t('generation.csvStructureTitle', { ns: 'share' })}</div>
      <div className="mt-2 max-h-[500px] overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-divider-regular text-xs">
          <thead className="text-text-tertiary">
            <tr>
              <td className="h-9 border-b border-divider-regular pl-3 pr-2">{t('batchModal.question', { ns: 'appAnnotation' })}</td>
              <td className="h-9 border-b border-divider-regular pl-3 pr-2">{t('batchModal.answer', { ns: 'appAnnotation' })}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            <tr>
              <td className="h-9 border-b border-divider-subtle pl-3 pr-2 text-[13px]">
                {t('batchModal.question', { ns: 'appAnnotation' })}
                {' '}
                1
              </td>
              <td className="h-9 border-b border-divider-subtle pl-3 pr-2 text-[13px]">
                {t('batchModal.answer', { ns: 'appAnnotation' })}
                {' '}
                1
              </td>
            </tr>
            <tr>
              <td className="h-9 pl-3 pr-2 text-[13px]">
                {t('batchModal.question', { ns: 'appAnnotation' })}
                {' '}
                2
              </td>
              <td className="h-9 pl-3 pr-2 text-[13px]">
                {t('batchModal.answer', { ns: 'appAnnotation' })}
                {' '}
                2
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CSVDownloader
        className="mt-2 block cursor-pointer"
        type={Type.Link}
        filename={`template-${locale}`}
        bom={true}
        data={getTemplate()}
      >
        <div className="system-xs-medium flex h-[18px] items-center space-x-1 text-text-accent">
          <DownloadIcon className="mr-1 h-3 w-3" />
          {t('batchModal.template', { ns: 'appAnnotation' })}
        </div>
      </CSVDownloader>
    </div>

  )
}
export default React.memo(CSVDownload)
