import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import ContextMenu from './context-menu'
import cn from '@/utils/classnames'
import type { VersionHistory } from '@/types/workflow'
import { type VersionHistoryContextMenuOptions, WorkflowVersion } from '../../types'
import { useWorkflowAliasList } from '@/service/use-workflow-alias'
import { useStore as useAppStore } from '@/app/components/app/store'
import Tag from '@/app/components/base/tag'

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
  const appDetail = useAppStore.getState().appDetail

  const { data: aliasList } = useWorkflowAliasList({
    appId: appDetail!.id,
    workflowId: item.id,
  })

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
      {!isLast && <div className='absolute left-4 top-6 h-[calc(100%-0.75rem)] w-0.5 bg-divider-subtle' />}
      <div className=' flex h-5 w-[18px] shrink-0 items-center justify-center'>
        <div className={cn(
          'h-2 w-2 rounded-lg border-[2px]',
          isSelected ? 'border-text-accent' : 'border-text-quaternary',
        )}/>
      </div>
      <div className='flex grow flex-col gap-y-0.5 overflow-hidden'>
        <div className='mr-6 flex h-5 items-center gap-x-1'>
          <div className={cn(
            'system-sm-semibold truncate py-[1px]',
            isSelected ? 'text-text-accent' : 'text-text-secondary',
          )}>
            {isDraft ? t('workflow.versionHistory.currentDraft') : item.marked_name || t('workflow.versionHistory.defaultName')}
          </div>
          {isLatest && (
            <div className='system-2xs-medium-uppercase flex h-5 shrink-0 items-center rounded-md border border-text-accent-secondary
            bg-components-badge-bg-dimm px-[5px] text-text-accent-secondary'>
              {t('workflow.versionHistory.latest')}
            </div>
          )}
        </div>
        {!isDraft && aliasList?.items && aliasList.items.length > 0 && (
          <div className='mt-0.5 flex flex-wrap items-center gap-0.5'>
            {aliasList.items
              .sort((a, b) => {
                if (a.alias_type === 'system' && b.alias_type !== 'system') return -1
                if (a.alias_type !== 'system' && b.alias_type === 'system') return 1
                return 0
              })
              .slice(0, 2)
              .map(alias => (
                <Tag
                  key={alias.id}
                  color={alias.alias_type === 'system' ? 'red' : 'green'}
                  className="px-1.5 py-0.5 text-xs"
                >
                  {alias.alias_name}
                </Tag>
              ))}
            {aliasList.items.length > 2 && (
              <span className="ml-1 text-xs text-text-tertiary">
                +{aliasList.items.length - 2}
              </span>
            )}
          </div>
        )}
        {
          !isDraft && (
            <div className='system-xs-regular break-words text-text-secondary'>
              {item.marked_comment || ''}
            </div>
          )
        }
        {
          !isDraft && (
            <div className='system-xs-regular truncate text-text-tertiary'>
              {`${formatTime(item.created_at)} · ${item.created_by.name}`}
            </div>
          )
        }
      </div>
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
