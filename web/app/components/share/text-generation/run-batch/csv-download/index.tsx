'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Download02 as DownloadIcon } from '@/app/components/base/icons/src/vender/solid/general'
import { downloadCSV } from '@/utils/csv'

export type ICSVDownloadProps = {
  vars: { name: string }[]
}

const CSVDownload: FC<ICSVDownloadProps> = ({
  vars,
}) => {
  const { t } = useTranslation()
  const addQueryContentVars = [...vars]
  const template = (() => {
    const res: Record<string, string> = {}
    addQueryContentVars.forEach((item) => {
      res[item.name] = ''
    })
    return res
  })()

  const handleDownload = () => {
    downloadCSV([template], 'template', { bom: true })
  }

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
      <button
        type="button"
        className="mt-2 block cursor-pointer"
        onClick={handleDownload}
      >
        <div className="system-xs-medium flex h-[18px] items-center space-x-1 text-text-accent">
          <DownloadIcon className="h-3 w-3" />
          <span>{t('generation.downloadTemplate', { ns: 'share' })}</span>
        </div>
      </button>
    </div>

  )
}
export default React.memo(CSVDownload)
