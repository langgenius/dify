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
        'flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-200',
        'hover:transform hover:translate-x-1',
        'text-sm font-medium text-gray-700',
        item.version === selectedVersion ? 'bg-blue-50' : 'hover:bg-gray-50',
        item.version === WorkflowVersion.Draft ? 'cursor-not-allowed opacity-80' : 'cursor-pointer',
      )}
      onClick={() => item.version !== WorkflowVersion.Draft && onClick(item)}
    >
      <div className="flex items-center gap-3">
        <span className="text-gray-500">
          {formatTime(item.version === WorkflowVersion.Draft ? item.updated_at : item.created_at)}
        </span>
        <div className="flex items-center gap-2">
          {renderVersionLabel(item.version)}
          <span className="text-gray-600">
        published by <span className="font-semibold">{item.created_by.name}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export default React.memo(VersionHistoryItem)
