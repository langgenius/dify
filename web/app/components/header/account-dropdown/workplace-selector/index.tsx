import type { Plan } from '@/app/components/billing/type'
import type { IWorkspace } from '@/models/common'
import {
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemText,
} from '@langgenius/dify-ui/select'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { PlanBadge } from '@/app/components/header/plan-badge'

type WorkplaceSelectorContentProps = {
  workspaces: IWorkspace[]
  popupClassName?: string
}

type WorkplaceSelectorItemProps = {
  workspace: IWorkspace
}

const WorkplaceSelectorItem = memo(({
  workspace,
}: WorkplaceSelectorItemProps) => (
  <SelectItem value={workspace.id} className="gap-2 py-1 pr-2 pl-3">
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-[13px]">
      <span className="h-6 bg-linear-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle leading-6 font-semibold text-shadow-shadow-1 uppercase opacity-90">
        {workspace.name[0]?.toLocaleUpperCase()}
      </span>
    </div>
    <SelectItemText className="system-md-regular">{workspace.name}</SelectItemText>
    <PlanBadge plan={workspace.plan as Plan} />
  </SelectItem>
))
WorkplaceSelectorItem.displayName = 'WorkplaceSelectorItem'

export const WorkplaceSelectorContent = memo(({
  workspaces,
  popupClassName = 'w-[280px] transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:scale-100 data-ending-style:opacity-100',
}: WorkplaceSelectorContentProps) => {
  const { t } = useTranslation()

  return (
    <SelectContent popupClassName={popupClassName}>
      <SelectGroup>
        <SelectGroupLabel>
          {t('userProfile.workspace', { ns: 'common' })}
        </SelectGroupLabel>
        {workspaces.map(workspace => (
          <WorkplaceSelectorItem key={workspace.id} workspace={workspace} />
        ))}
      </SelectGroup>
    </SelectContent>
  )
})
WorkplaceSelectorContent.displayName = 'WorkplaceSelectorContent'
