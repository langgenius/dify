import type { VersionHistoryContextMenuOptions } from '../../types'
import type { VersionHistory } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import dayjs from 'dayjs'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkflowVersion } from '../../types'
import ActionMenu from './action-menu'

type VersionHistoryItemProps = {
  item: VersionHistory
  currentVersion: VersionHistory | null
  latestVersionId: string
  onClick: (item: VersionHistory) => void
  handleClickActionMenuItem: (operation: VersionHistoryContextMenuOptions) => void
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
  handleClickActionMenuItem,
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
  }, [])

  const handleClickItem = () => {
    if (isSelected)
      return
    onClick(item)
  }

  return (
    <div
      className={cn(
        'group relative flex gap-x-1 rounded-lg p-2',
        isSelected ? 'cursor-not-allowed bg-state-accent-active' : 'cursor-pointer hover:bg-state-base-hover',
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
      {!isLast && <div className="absolute top-6 left-4 h-[calc(100%-0.75rem)] w-0.5 bg-divider-subtle" />}
      <div className="flex h-5 w-[18px] shrink-0 items-center justify-center">
        <div className={cn(
          'h-2 w-2 rounded-lg border-2',
          isSelected ? 'border-text-accent' : 'border-text-quaternary',
        )}
        />
      </div>
      <div className="flex grow flex-col gap-y-0.5 overflow-hidden">
        <div className="mr-6 flex h-5 items-center gap-x-1">
          <div className={cn(
            'truncate py-px system-sm-semibold',
            isSelected ? 'text-text-accent' : 'text-text-secondary',
          )}
          >
            {isDraft ? t('versionHistory.currentDraft', { ns: 'workflow' }) : item.marked_name || t('versionHistory.defaultName', { ns: 'workflow' })}
          </div>
          {isLatest && (
            <div className="flex h-5 shrink-0 items-center rounded-md border border-text-accent-secondary bg-components-badge-bg-dimm
            px-[5px] system-2xs-medium-uppercase text-text-accent-secondary"
            >
              {t('versionHistory.latest', { ns: 'workflow' })}
            </div>
          )}
        </div>
        {
          !isDraft && (
            <div className="system-xs-regular wrap-break-word text-text-secondary">
              {item.marked_comment || ''}
            </div>
          )
        }
        {
          !isDraft && (
            <div className="truncate system-xs-regular text-text-tertiary">
              {`${formatTime(item.created_at)} · ${item.created_by.name}`}
            </div>
          )
        }
      </div>
      {/* Action Menu */}
      {!isDraft && isHovering && (
        <div className="absolute top-1 right-1">
          <ActionMenu
            isShowDelete={!isLatest}
            isNamedVersion={!!item.marked_name}
            open={open}
            setOpen={setOpen}
            handleClickActionMenuItem={handleClickActionMenuItem}
          />
        </div>
      )}
    </div>
  )
}

export default React.memo(VersionHistoryItem)
