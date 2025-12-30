'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'

export type ICSVDownloadProps = {
  vars: { name: string }[]
}

const CSVDownload: FC<ICSVDownloadProps> = ({
  vars,
}) => {
  const { t } = useTranslation()
  const { CSVDownloader, Type } = useCSVDownloader()
  const addQueryContentVars = [...vars]
  const template = (() => {
    const res: Record<string, string> = {}
    addQueryContentVars.forEach((item) => {
      res[item.name] = ''
    })
    return res
  })()

  return (
    <div className="mt-6">
      <div className="system-sm-medium text-text-primary">{t('generation.csvStructureTitle', { ns: 'share' })}</div>
      <div className="mt-2 max-h-[500px] overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-divider-regular text-xs">
          <thead className="text-text-tertiary">
            <tr>
              {addQueryContentVars.map((item, i) => (
                <td key={i} className="h-9 border-b border-divider-regular pl-3 pr-2">{item.name}</td>
              ))}
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            <tr>
              {addQueryContentVars.map((item, i) => (
                <td key={i} className="h-9 pl-4">
                  {item.name}
                  {' '}
                  {t('generation.field', { ns: 'share' })}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <CSVDownloader
        className="mt-2 block cursor-pointer"
        type={Type.Link}
        filename="template"
        bom={true}
        config={{
          // delimiter: ';',
        }}
        data={[
          template,
        ]}
      >
        <div className="system-xs-medium flex h-[18px] items-center space-x-1 text-text-accent">
          <DownloadIcon className="h-3 w-3" />
          <span>{t('generation.downloadTemplate', { ns: 'share' })}</span>
        </div>
      </CSVDownloader>
    </div>

  )
}
export default React.memo(CSVDownload)
