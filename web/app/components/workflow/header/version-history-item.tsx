import React from 'react';
import dayjs from 'dayjs';
import { WorkflowVersion } from '../types';
import cn from '@/utils/classnames';
import type { VersionHistory } from '@/types/workflow';

type VersionHistoryItemProps = {
  item: VersionHistory
  selectedVersion: string
  onClick: (item: VersionHistory) => void
}

const VersionHistoryItem: React.FC<VersionHistoryItemProps> = ({ item, selectedVersion, onClick }) => {
  const formatTime = (time: number) => {
    return dayjs.unix(time).format('YYYY-MM-DD HH:mm:ss')
  }

  const renderVersionLabel = (version: string) => {
    switch (version) {
      case WorkflowVersion.Draft:
        return (
          <div className="w-20 py-1 text-center rounded-md bg-[#EAECEF] text-[#707A8A]">
            {version}
          </div>
        )
      case WorkflowVersion.Current:
        return (
          <div className="w-20 py-1 text-center rounded-md bg-[#F2FFF7] text-[#0ECB81]">
            {version}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        'flex mb-1 p-2 rounded-lg items-center justify-between h-12',
        item.version === selectedVersion ? 'bg-primary-50' : 'hover:bg-primary-50 cursor-pointer',
      )}
      onClick={() => onClick(item)}
    >
      <div>{formatTime(item.version === WorkflowVersion.Draft ? item.updated_at : item.created_at)}</div>
      {renderVersionLabel(item.version)}
    </div>
  )
}

export default React.memo(VersionHistoryItem);
