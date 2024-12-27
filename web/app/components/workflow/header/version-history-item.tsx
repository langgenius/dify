import React from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { WorkflowVersion } from '../types'
import cn from '@/utils/classnames'
import type { VersionHistory } from '@/types/workflow'

type VersionHistoryItemProps = {
  item: VersionHistory
  selectedVersion: string
  onClick: (item: VersionHistory) => void
  curIdx: number
  page: number
}

const formatVersion = (version: string, curIdx: number, page: number): string => {
  if (curIdx === 0 && page === 1)
    return WorkflowVersion.Draft
  if (curIdx === 1 && page === 1)
    return WorkflowVersion.Latest
  try {
    const date = new Date(version)
    if (isNaN(date.getTime()))
      return version

    // format as YYYY-MM-DD HH:mm:ss
    return date.toISOString().slice(0, 19).replace('T', ' ')
  }
  catch {
    return version
  }
}

const VersionHistoryItem: React.FC<VersionHistoryItemProps> = ({ item, selectedVersion, onClick, curIdx, page }) => {
  const { t } = useTranslation()
  const formatTime = (time: number) => dayjs.unix(time).format('YYYY-MM-DD HH:mm:ss')
  const formattedVersion = formatVersion(item.version, curIdx, page)
  const renderVersionLabel = (version: string) => (
    (version === WorkflowVersion.Draft || version === WorkflowVersion.Latest)
      ? (
        <div className="shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate">
          {version}
        </div>
      )
      : null
  )

  return (
    <div
      className={cn(
        'flex items-center p-2 h-12 text-xs font-medium text-gray-700 justify-between',
        formattedVersion === selectedVersion ? '' : 'hover:bg-gray-100',
        formattedVersion === WorkflowVersion.Draft ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
      onClick={() => item.version !== WorkflowVersion.Draft && onClick(item)}
    >
      <div className='flex flex-col gap-1 py-2'>
        <span className="text-left">{formatTime(formattedVersion === WorkflowVersion.Draft ? item.updated_at : item.created_at)}</span>
        <span className="text-left">{t('workflow.panel.createdBy')}  {item.created_by.name}</span>
      </div>
      {renderVersionLabel(formattedVersion)}
    </div>
  )
}

export default React.memo(VersionHistoryItem)
