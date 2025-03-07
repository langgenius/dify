import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import ContextMenu from './context-menu'
import cn from '@/utils/classnames'
import type { VersionHistory } from '@/types/workflow'
import { type VersionHistoryContextMenuOptions, WorkflowVersion } from '../../types'

type VersionHistoryItemProps = {
  item: VersionHistory
  currentVersion: VersionHistory | null
  latestVersionId: string
  onClick: (item: VersionHistory) => void
  handleClickMenuItem: (operation: VersionHistoryContextMenuOptions) => void
  isLast: boolean
}

const formatVersion = (versionHistory: VersionHistory, latestVersionId: string): string => {
  const { version, id } = versionHistory
  if (version === WorkflowVersion.Draft)
    return WorkflowVersion.Draft
  if (id === latestVersionId)
    return WorkflowVersion.Latest
  try {
    const date = new Date(version)
    if (Number.isNaN(date.getTime()))
      return version

    // format as YYYY-MM-DD HH:mm:ss
    return date.toISOString().slice(0, 19).replace('T', ' ')
  }
  catch {
    return version
  }
}

const VersionHistoryItem: React.FC<VersionHistoryItemProps> = ({
  item,
  currentVersion,
  latestVersionId,
  onClick,
  handleClickMenuItem,
  isLast,
}) => {
  const { t } = useTranslation()
  const [isHovering, setIsHovering] = useState(false)
  const [open, setOpen] = useState(false)

  const formatTime = (time: number) => dayjs.unix(time).format('YYYY-MM-DD HH:mm')
  const formattedVersion = formatVersion(item, latestVersionId)
  const isSelected = item.version === currentVersion?.version
  const isDraft = formattedVersion === WorkflowVersion.Draft
  const isLatest = formattedVersion === WorkflowVersion.Latest

  useEffect(() => {
    if (isDraft)
      onClick(item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClickItem = () => {
    if (isSelected)
      return
    onClick(item)
  }

  return (
    <div
      className={cn(
        'flex gap-x-1 relative p-2 rounded-lg group',
        isSelected ? 'bg-state-accent-active cursor-not-allowed' : 'hover:bg-state-base-hover cursor-pointer',
      )}
      onClick={handleClickItem}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false)
        setOpen(false)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setOpen(true)
      }}
    >
      {!isLast && <div className='absolute w-0.5 h-[calc(100%-0.75rem)] left-4 top-6 bg-divider-subtle' />}
      <div className=' flex items-center justify-center shrink-0 w-[18px] h-5'>
        <div className={cn(
          'w-2 h-2 border-[2px] rounded-lg',
          isSelected ? 'border-text-accent' : 'border-text-quaternary',
        )}/>
      </div>
      <div className='flex flex-col gap-y-0.5 grow overflow-hidden'>
        <div className='flex items-center gap-x-1 h-5 mr-6'>
          <div className={cn(
            'py-[1px] system-sm-semibold truncate',
            isSelected ? 'text-text-accent' : 'text-text-secondary',
          )}>
            {isDraft ? t('workflow.versionHistory.currentDraft') : item.marked_name || t('workflow.versionHistory.defaultName')}
          </div>
          {isLatest && (
            <div className='flex items-center shrink-0 h-5 px-[5px] rounded-md border border-text-accent-secondary
            bg-components-badge-bg-dimm text-text-accent-secondary system-2xs-medium-uppercase'>
              {t('workflow.versionHistory.latest')}
            </div>
          )}
        </div>
        {
          !isDraft && (
            <div className='text-text-secondary system-xs-regular break-words'>
              {item.marked_comment || ''}
            </div>
          )
        }
        {
          !isDraft && (
            <div className='text-text-tertiary system-xs-regular truncate'>
              {`${formatTime(item.created_at)} · ${item.created_by.name}`}
            </div>
          )
        }
      </div>
      {/* Context Menu */}
      {!isDraft && isHovering && (
        <div className='absolute right-1 top-1'>
          <ContextMenu
            isShowDelete={!isLatest}
            isNamedVersion={!!item.marked_name}
            open={open}
            setOpen={setOpen}
            handleClickMenuItem={handleClickMenuItem}
          />
        </div>
      )}
    </div>
  )
}

export default React.memo(VersionHistoryItem)
