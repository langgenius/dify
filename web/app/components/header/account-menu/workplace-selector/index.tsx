import type { TenantListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SelectContentProps } from '@langgenius/dify-ui/select'
import { cn } from '@langgenius/dify-ui/cn'
import {
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
} from '@langgenius/dify-ui/select'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import { PlanBadge } from '@/app/components/header/plan-badge'

type WorkplaceSelectorContentProps = {
  workspaces: TenantListItemResponse[]
  popupClassName?: string
  align?: SelectContentProps['align']
  unavailableWorkspace?: { id: string; label: string }
}

type WorkplaceSelectorItemProps = {
  workspace: TenantListItemResponse
  unavailableLabel?: string
  showSelectionIndicator: boolean
}

const WorkplaceSelectorItem = memo(
  ({ workspace, unavailableLabel, showSelectionIndicator }: WorkplaceSelectorItemProps) => {
    const workspaceName = workspace.name || workspace.id
    const unavailable = unavailableLabel !== undefined

    return (
      <SelectItem
        value={workspace.id}
        disabled={unavailable}
        className={cn(
          'gap-2 py-1 ps-3 pe-2',
          showSelectionIndicator && 'ps-1.5',
          unavailable && 'data-disabled:opacity-100 data-highlighted:bg-transparent',
        )}
      >
        <WorkspaceAvatar
          name={workspaceName}
          size="sm"
          className={unavailable ? 'opacity-35' : undefined}
        />
        <SelectItemText className={cn('system-md-regular', unavailable && 'text-text-placeholder')}>
          {workspaceName}
        </SelectItemText>
        {unavailable ? (
          <Badge
            as="span"
            size="xs"
            variant="dimm"
            uppercase={false}
            className="shrink-0 px-1.25 system-2xs-medium!"
          >
            {unavailableLabel}
          </Badge>
        ) : (
          <PlanBadge plan={workspace.plan ?? 'sandbox'} />
        )}
        {showSelectionIndicator && (
          <span className="size-4 shrink-0">
            <SelectItemIndicator />
          </span>
        )}
      </SelectItem>
    )
  },
)
WorkplaceSelectorItem.displayName = 'WorkplaceSelectorItem'

export const WorkplaceSelectorContent = memo(
  ({
    workspaces,
    popupClassName = 'w-[280px] transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:scale-100 data-ending-style:opacity-100',
    align,
    unavailableWorkspace,
  }: WorkplaceSelectorContentProps) => {
    const { t } = useTranslation(['common'])

    return (
      <SelectContent align={align} className={popupClassName}>
        <SelectGroup>
          <SelectGroupLabel>
            {t(($) => $['userProfile.workspace'], { ns: 'common' })}
          </SelectGroupLabel>
          {workspaces.map((workspace) => (
            <WorkplaceSelectorItem
              key={workspace.id}
              workspace={workspace}
              showSelectionIndicator={unavailableWorkspace !== undefined}
              unavailableLabel={
                workspace.id === unavailableWorkspace?.id ? unavailableWorkspace.label : undefined
              }
            />
          ))}
        </SelectGroup>
      </SelectContent>
    )
  },
)
WorkplaceSelectorContent.displayName = 'WorkplaceSelectorContent'
