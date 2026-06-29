'use client'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'

import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { downloadBlob } from '@/utils/download'

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

const JSONL_TEMPLATE_QA = [
  '{"question":"question1","answer":"answer1"}',
  '{"question":"question2","answer":"answer2"}',
].join('\n')

function CSVDownload() {
  const { t } = useTranslation()

  const locale = useLocale()
  const { CSVDownloader, Type } = useCSVDownloader()

  const getTemplate = () => {
    return locale !== LanguagesSupported[1] ? CSV_TEMPLATE_QA_EN : CSV_TEMPLATE_QA_CN
  }

  const downloadJsonlTemplate = () => {
    const file = new Blob([`${JSONL_TEMPLATE_QA}\n`], { type: 'application/jsonl' })
    downloadBlob({ data: file, fileName: `template-${locale}.jsonl` })
  }

  return (
    <div className="mt-6">
      <div className="system-sm-medium text-text-primary">{t('batchModal.tip', { ns: 'appAnnotation' })}</div>
      <div className="mt-2 max-h-[500px] overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-divider-regular text-xs">
          <thead className="text-text-tertiary">
            <tr>
              <td className="h-9 border-b border-divider-regular pr-2 pl-3">{t('batchModal.question', { ns: 'appAnnotation' })}</td>
              <td className="h-9 border-b border-divider-regular pr-2 pl-3">{t('batchModal.answer', { ns: 'appAnnotation' })}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            <tr>
              <td className="h-9 border-b border-divider-subtle pr-2 pl-3 text-[13px]">
                {t('batchModal.question', { ns: 'appAnnotation' })}
                {' '}
                1
              </td>
              <td className="h-9 border-b border-divider-subtle pr-2 pl-3 text-[13px]">
                {t('batchModal.answer', { ns: 'appAnnotation' })}
                {' '}
                1
              </td>
            </tr>
            <tr>
              <td className="h-9 pr-2 pl-3 text-[13px]">
                {t('batchModal.question', { ns: 'appAnnotation' })}
                {' '}
                2
              </td>
              <td className="h-9 pr-2 pl-3 text-[13px]">
                {t('batchModal.answer', { ns: 'appAnnotation' })}
                {' '}
                2
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 system-sm-medium text-text-primary">{t('batchModal.jsonlTip', { ns: 'appAnnotation' })}</div>
        <pre className="mt-2 overflow-auto rounded-lg border border-divider-regular bg-components-panel-bg p-3 text-xs text-text-secondary">
          {JSONL_TEMPLATE_QA}
        </pre>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <CSVDownloader
          className="block cursor-pointer"
          type={Type.Link}
          filename={`template-${locale}`}
          bom={true}
          data={getTemplate()}
        >
          <div className="flex h-[18px] items-center system-xs-medium text-text-accent">
            <DownloadIcon className="mr-1 size-3" aria-hidden="true" />
            {t('batchModal.csvTemplate', { ns: 'appAnnotation' })}
          </div>
        </CSVDownloader>
        <button
          type="button"
          className="flex h-[18px] cursor-pointer items-center border-none bg-transparent p-0 system-xs-medium text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={downloadJsonlTemplate}
        >
          <DownloadIcon className="mr-1 size-3" aria-hidden="true" />
          {t('batchModal.jsonlTemplate', { ns: 'appAnnotation' })}
        </button>
      </div>
    </div>

  )
}
export default React.memo(CSVDownload)
