import React from 'react'
import dayjs from 'dayjs'
import { WorkflowVersion } from '../types'
import cn from '@/utils/classnames'
import type { VersionHistory } from '@/types/workflow'

type VersionHistoryItemProps = {
  item: VersionHistory
  selectedVersion: string
  onClick: (item: VersionHistory) => void
}

const VersionHistoryItem: React.FC<VersionHistoryItemProps> = ({ item, selectedVersion, onClick }) => {
  const formatTime = (time: number) => dayjs.unix(time).format('YYYY-MM-DD HH:mm:ss')

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
        'flex items-center p-2 h-9 text-xs font-medium text-gray-700 justify-between',
        item.version === selectedVersion ? '' : 'hover:bg-gray-100',
        item.version === WorkflowVersion.Draft ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
      onClick={() => item.version !== WorkflowVersion.Draft && onClick(item)}
    >
      <div>{formatTime(item.version === WorkflowVersion.Draft ? item.updated_at : item.created_at)}</div>
      {renderVersionLabel(item.version)}
    </div>
  )
}

export default React.memo(VersionHistoryItem)
