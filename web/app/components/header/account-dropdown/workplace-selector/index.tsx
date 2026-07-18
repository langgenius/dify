import type { TenantListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import {
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemText,
} from '@langgenius/dify-ui/select'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import { Plan } from '@/app/components/billing/type'
import { PlanBadge } from '@/app/components/header/plan-badge'

type WorkplaceSelectorContentProps = {
  workspaces: TenantListItemResponse[]
  popupClassName?: string
}

type WorkplaceSelectorItemProps = {
  workspace: TenantListItemResponse
}

const workspacePlans = new Set<string>(Object.values(Plan))

function isWorkspacePlan(plan: string | null | undefined): plan is Plan {
  return !!plan && workspacePlans.has(plan)
}

const WorkplaceSelectorItem = memo(({ workspace }: WorkplaceSelectorItemProps) => {
  const workspaceName = workspace.name || workspace.id
  const workspacePlan = isWorkspacePlan(workspace.plan) ? workspace.plan : Plan.sandbox

  return (
    <SelectItem value={workspace.id} className="gap-2 py-1 pr-2 pl-3">
      <WorkspaceAvatar name={workspaceName} size="sm" />
      <SelectItemText className="system-md-regular">{workspaceName}</SelectItemText>
      <PlanBadge plan={workspacePlan} />
    </SelectItem>
  )
})
WorkplaceSelectorItem.displayName = 'WorkplaceSelectorItem'

export const WorkplaceSelectorContent = memo(
  ({
    workspaces,
    popupClassName = 'w-[280px] transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:scale-100 data-ending-style:opacity-100',
  }: WorkplaceSelectorContentProps) => {
    const { t } = useTranslation()

    return (
      <SelectContent popupClassName={popupClassName}>
        <SelectGroup>
          <SelectGroupLabel>
            {t(($) => $['userProfile.workspace'], { ns: 'common' })}
          </SelectGroupLabel>
          {workspaces.map((workspace) => (
            <WorkplaceSelectorItem key={workspace.id} workspace={workspace} />
          ))}
        </SelectGroup>
      </SelectContent>
    )
  },
)
WorkplaceSelectorContent.displayName = 'WorkplaceSelectorContent'
