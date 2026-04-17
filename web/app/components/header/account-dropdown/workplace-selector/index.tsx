import type { Plan } from '@/app/components/billing/type'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemText,
  SelectLabel,
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
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
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
        className="w-auto cursor-pointer rounded-[10px] border-0 bg-transparent p-0.5 hover:bg-state-base-hover data-popup-open:bg-state-base-hover"
      >
        <div className="flex items-center">
          <div className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-[13px] max-[800px]:mr-0">
            <span className="h-6 bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle leading-6 font-semibold text-shadow-shadow-1 uppercase opacity-90">
              {currentWorkspace?.name[0]?.toLocaleUpperCase()}
            </span>
          </div>
          <div className="max-w-[149px] min-w-0 truncate system-sm-medium text-text-secondary max-[800px]:hidden">
            {currentWorkspace?.name}
          </div>
        </div>
      </SelectTrigger>
      <SelectContent popupClassName="w-[280px]">
        <SelectGroup>
          <SelectLabel>
            {t('userProfile.workspace', { ns: 'common' })}
          </SelectLabel>
          {workspaces.map(workspace => (
            <SelectItem key={workspace.id} value={workspace.id} className="gap-2 py-1 pr-2 pl-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-[13px]">
                <span className="h-6 bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle leading-6 font-semibold text-shadow-shadow-1 uppercase opacity-90">
                  {workspace.name[0]?.toLocaleUpperCase()}
                </span>
              </div>
              <SelectItemText className="system-md-regular">{workspace.name}</SelectItemText>
              <PlanBadge plan={workspace.plan as Plan} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
export default WorkplaceSelector
