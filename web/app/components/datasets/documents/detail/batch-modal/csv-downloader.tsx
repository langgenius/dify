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
import { ChunkingMode } from '@/models/datasets'

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

const CSVDownload: FC<{ docForm: ChunkingMode }> = ({ docForm }) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const { CSVDownloader, Type } = useCSVDownloader()

  const getTemplate = () => {
    if (locale === LanguagesSupported[1]) {
      if (docForm === ChunkingMode.qa)
        return CSV_TEMPLATE_QA_CN
      return CSV_TEMPLATE_CN
    }
    if (docForm === ChunkingMode.qa)
      return CSV_TEMPLATE_QA_EN
    return CSV_TEMPLATE_EN
  }

  return (
    <div className="mt-6">
      <div className="text-sm font-medium text-text-primary">{t('generation.csvStructureTitle', { ns: 'share' })}</div>
      <div className="mt-2 max-h-[500px] overflow-auto">
        {docForm === ChunkingMode.qa && (
          <table className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-divider-subtle text-xs">
            <thead className="text-text-secondary">
              <tr>
                <td className="h-9 border-b border-divider-subtle pl-3 pr-2">{t('list.batchModal.question', { ns: 'datasetDocuments' })}</td>
                <td className="h-9 border-b border-divider-subtle pl-3 pr-2">{t('list.batchModal.answer', { ns: 'datasetDocuments' })}</td>
              </tr>
            </thead>
            <tbody className="text-text-tertiary">
              <tr>
                <td className="h-9 border-b border-divider-subtle pl-3 pr-2 text-[13px]">
                  {t('list.batchModal.question', { ns: 'datasetDocuments' })}
                  {' '}
                  1
                </td>
                <td className="h-9 border-b border-divider-subtle pl-3 pr-2 text-[13px]">
                  {t('list.batchModal.answer', { ns: 'datasetDocuments' })}
                  {' '}
                  1
                </td>
              </tr>
              <tr>
                <td className="h-9 pl-3 pr-2 text-[13px]">
                  {t('list.batchModal.question', { ns: 'datasetDocuments' })}
                  {' '}
                  2
                </td>
                <td className="h-9 pl-3 pr-2 text-[13px]">
                  {t('list.batchModal.answer', { ns: 'datasetDocuments' })}
                  {' '}
                  2
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {docForm === ChunkingMode.text && (
          <table className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-divider-subtle text-xs">
            <thead className="text-text-secondary">
              <tr>
                <td className="h-9 border-b border-divider-subtle pl-3 pr-2">{t('list.batchModal.contentTitle', { ns: 'datasetDocuments' })}</td>
              </tr>
            </thead>
            <tbody className="text-text-tertiary">
              <tr>
                <td className="h-9 border-b border-divider-subtle pl-3 pr-2 text-[13px]">
                  {t('list.batchModal.content', { ns: 'datasetDocuments' })}
                  {' '}
                  1
                </td>
              </tr>
              <tr>
                <td className="h-9 pl-3 pr-2 text-[13px]">
                  {t('list.batchModal.content', { ns: 'datasetDocuments' })}
                  {' '}
                  2
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <CSVDownloader
        className="mt-2 block cursor-pointer"
        type={Type.Link}
        filename="template"
        bom={true}
        data={getTemplate()}
      >
        <div className="flex h-[18px] items-center space-x-1 text-xs font-medium text-text-accent">
          <DownloadIcon className="mr-1 h-3 w-3" />
          {t('list.batchModal.template', { ns: 'datasetDocuments' })}
        </div>
      </CSVDownloader>
    </div>

  )
}
export default React.memo(CSVDownload)
