import type { Plan } from '@/app/components/billing/type'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItemText,
  SelectPrimitiveItem,
  SelectTrigger,
} from '@/app/components/base/ui/select'
import { toast } from '@/app/components/base/ui/toast'
import PlanBadge from '@/app/components/header/plan-badge'
import { useWorkspacesContext } from '@/context/workspace-context'
import { switchWorkspace } from '@/service/common'
import { basePath } from '@/utils/var'

const WorkplaceSelector = () => {
  const { t } = useTranslation()
  const { workspaces } = useWorkspacesContext()
  const currentWorkspace = workspaces.find(v => v.current)
  const handleSwitchWorkspace = async (tenant_id: string) => {
    try {
      if (currentWorkspace?.id === tenant_id)
        return
      await switchWorkspace({ url: '/workspaces/switch', body: { tenant_id } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      location.assign(`${location.origin}${basePath}`)
    }
    catch {
      toast.error(t('provider.saveFailed', { ns: 'common' }))
    }
  }
  return (
    <Select
      value={currentWorkspace?.id ?? ''}
      onValueChange={(value) => {
        if (value)
          void handleSwitchWorkspace(value)
      }}
    >
      <SelectTrigger
        className={cn(
          'group flex min-w-0 cursor-pointer items-center rounded-[10px] p-0.5 outline-hidden',
          'hover:bg-state-base-hover data-popup-open:bg-state-base-hover',
        )}
      >
        <div className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-[13px] max-[800px]:mr-0">
          <span className="h-6 bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle leading-6 font-semibold text-shadow-shadow-1 uppercase opacity-90">{currentWorkspace?.name[0]?.toLocaleUpperCase()}</span>
        </div>
        <div className="flex min-w-0 items-center">
          <div className="max-w-[149px] min-w-0 truncate system-sm-medium text-text-secondary max-[800px]:hidden">{currentWorkspace?.name}</div>
          <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-secondary" />
        </div>
      </SelectTrigger>
      <SelectContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-[280px] max-h-[400px]"
      >
        <SelectGroup>
          <SelectGroupLabel>
            {t('userProfile.workspace', { ns: 'common' })}
          </SelectGroupLabel>
          {workspaces.map(workspace => (
            <SelectPrimitiveItem
              key={workspace.id}
              value={workspace.id}
              className={cn(
                'flex h-8 cursor-pointer items-center gap-2 rounded-lg pr-2 pl-3 outline-hidden',
                'data-highlighted:bg-state-base-hover',
              )}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-[13px]">
                <span className="h-6 bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle leading-6 font-semibold text-shadow-shadow-1 uppercase opacity-90">{workspace.name[0]?.toLocaleUpperCase()}</span>
              </div>
              <SelectItemText className="min-w-0 grow truncate system-md-regular text-text-secondary">
                {workspace.name}
              </SelectItemText>
              <PlanBadge plan={workspace.plan as Plan} />
            </SelectPrimitiveItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
export default WorkplaceSelector
