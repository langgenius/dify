import type { VersionHistoryContextMenuOptions } from '../../types'
import type { VersionHistory } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import dayjs from 'dayjs'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge/index'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import { WorkflowVersion } from '../../types'
import ActionMenu from './action-menu'

type VersionHistoryItemProps = {
  item: VersionHistory
  currentVersion: VersionHistory | null
  latestVersionId: string
  onClick: (item: VersionHistory) => void
  handleClickActionMenuItem: (operation: VersionHistoryContextMenuOptions) => void
  canImportExportDSL: boolean
  isLast: boolean
  hideActionMenu?: boolean
}

const formatVersion = (versionHistory: VersionHistory, latestVersionId: string): string => {
  const { version, id } = versionHistory
  if (version === WorkflowVersion.Draft) return WorkflowVersion.Draft
  if (id === latestVersionId) return WorkflowVersion.Latest
  try {
    const date = new Date(version)
    if (Number.isNaN(date.getTime())) return version

    // format as YYYY-MM-DD HH:mm:ss
    return date.toISOString().slice(0, 19).replace('T', ' ')
  } catch {
    return version
  }
}

const VersionHistoryItem: React.FC<VersionHistoryItemProps> = ({
  item,
  currentVersion,
  latestVersionId,
  onClick,
  handleClickActionMenuItem,
  canImportExportDSL,
  isLast,
  hideActionMenu,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const formatTime = (time: number) => dayjs.unix(time).format('YYYY-MM-DD HH:mm')
  const formattedVersion = formatVersion(item, latestVersionId)
  const isSelected = item.version === currentVersion?.version
  const isDraft = formattedVersion === WorkflowVersion.Draft
  const isLatest = formattedVersion === WorkflowVersion.Latest
  const deployedEnvironments = item.environments || []
  const titleId = React.useId()
  const didSelectDraftRef = React.useRef(false)

  useEffect(() => {
    if (!isDraft || didSelectDraftRef.current) return

    didSelectDraftRef.current = true
    onClick(item)
  }, [isDraft, item, onClick])

  const handleClickItem = () => {
    if (isSelected) return
    onClick(item)
  }

  return (
    <div
      className={cn(
        'group relative flex gap-x-1 rounded-lg p-2',
        isSelected ? 'bg-state-accent-active' : 'hover:bg-state-base-hover',
      )}
      onMouseLeave={() => setOpen(false)}
      onContextMenu={(e) => {
        if (hideActionMenu) return

        e.preventDefault()
        setOpen(true)
      }}
    >
      <button
        type="button"
        aria-labelledby={titleId}
        aria-current={isSelected ? 'true' : undefined}
        className={cn(
          'absolute inset-0 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          isSelected ? 'cursor-default' : 'cursor-pointer',
        )}
        onClick={handleClickItem}
      />
      {!isLast && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-6 left-4 h-[calc(100%-0.75rem)] w-0.5 bg-divider-subtle"
        />
      )}
      <div className="pointer-events-none relative z-[1] flex h-5 w-4.5 shrink-0 items-center justify-center">
        <div
          aria-hidden
          className={cn(
            'size-2 rounded-lg border-2',
            isSelected ? 'border-text-accent' : 'border-text-quaternary',
          )}
        />
      </div>
      <div className="pointer-events-none relative z-[1] flex grow flex-col gap-y-0.5 overflow-hidden">
        <div className="mr-6 flex h-5 items-center gap-x-1">
          <div
            id={titleId}
            className={cn(
              'truncate py-px system-sm-semibold',
              isSelected ? 'text-text-accent' : 'text-text-secondary',
            )}
          >
            {isDraft
              ? t(($) => $['versionHistory.currentDraft'], { ns: 'workflow' })
              : getWorkflowVersionName(
                  item,
                  t(($) => $['versionHistory.defaultName'], { ns: 'workflow' }),
                )}
          </div>
          {isLatest && (
            <div className="flex h-5 shrink-0 items-center rounded-md border border-text-accent-secondary bg-components-badge-bg-dimm px-1.25 system-2xs-medium-uppercase text-text-accent-secondary">
              {t(($) => $['versionHistory.latest'], { ns: 'workflow' })}
            </div>
          )}
        </div>
        {!isDraft && (
          <div className="system-xs-regular wrap-break-word text-text-secondary">
            {item.marked_comment || ''}
          </div>
        )}
        {!isDraft && (
          <div className="truncate system-xs-regular text-text-tertiary">
            {`${formatTime(item.created_at)} · ${item.created_by.name}`}
          </div>
        )}
        {!isDraft && deployedEnvironments.length > 0 && (
          <div className="flex w-full flex-wrap content-start items-start gap-x-1 gap-y-2 pt-0.5">
            {deployedEnvironments.map((environment) => (
              <Badge
                key={environment.id}
                size="s"
                className="h-4.5 shrink-0 bg-components-badge-bg-dimm py-0!"
              >
                {environment.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {/* Action Menu */}
      {!hideActionMenu && !isDraft && (
        <div
          className={cn(
            'invisible absolute top-1 right-1 z-10 group-focus-within:visible group-hover:visible',
            open && 'visible',
          )}
        >
          <ActionMenu
            workflowId={item.id}
            isShowDelete={!isLatest}
            isNamedVersion={!!item.marked_name}
            canImportExportDSL={canImportExportDSL}
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
