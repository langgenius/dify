'use client'

import type { ReactNode } from 'react'
import type { Plan as PlanType } from '@/app/components/billing/type'
import type { ICurrentWorkspace, IWorkspace } from '@/models/common'
import {
  Select,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { Plan } from '@/app/components/billing/type'
import { WorkplaceSelectorContent } from '@/app/components/header/account-dropdown/workplace-selector'
import { PlanBadge } from '@/app/components/header/plan-badge'

type AppliedEducationContentProps = {
  workspaces: IWorkspace[]
  currentWorkspace: ICurrentWorkspace
  plan: PlanType
  action: ReactNode
  onSwitchWorkspace: (tenantId: string) => void
}

const AppliedEducationContent = ({
  workspaces,
  currentWorkspace,
  plan,
  action,
  onSwitchWorkspace,
}: AppliedEducationContentProps) => {
  const { t } = useTranslation()
  const currentWorkspaceInList = workspaces.find(workspace => workspace.current)
  const workspacePlan = Object.values(Plan).includes(currentWorkspaceInList?.plan as Plan)
    ? currentWorkspaceInList?.plan as Plan
    : Object.values(Plan).includes(plan as Plan)
      ? plan as Plan
      : Plan.sandbox
  const workspaceName = currentWorkspaceInList?.name || currentWorkspace?.name
  const workspaceId = currentWorkspaceInList?.id || currentWorkspace?.id

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="rounded-lg border border-effects-highlight bg-background-default-subtle px-3">
        <div className="flex items-center gap-2">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-state-success-solid text-text-primary-on-surface">
            <span className="i-ri-check-line h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-text-secondary">
              {t('applied.step1.description', { ns: 'education' })}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-lg px-3">
        <div className="mb-3.5 flex items-center gap-2">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-components-icon-bg-blue-solid system-xs-semibold text-text-primary-on-surface">
            2
          </div>
          <div>
            <div className="system-xl-medium text-text-secondary">
              {t('applied.step2.description', { ns: 'education' })}
            </div>
          </div>
        </div>
        <div className="ml-7">
          <Select
            value={workspaceId ?? ''}
            onValueChange={(value) => {
              if (value)
                onSwitchWorkspace(value)
            }}
          >
            <SelectTrigger className="h-12! w-fit max-w-full min-w-[280px] cursor-pointer justify-between rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-3! py-1.5! hover:bg-state-base-hover">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-blue-solid text-[14px]">
                  <span className="bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text font-semibold text-shadow-shadow-1 uppercase opacity-90">
                    {workspaceName?.[0]?.toLocaleUpperCase()}
                  </span>
                </span>
                <span className="min-w-0 truncate system-md-semibold text-text-primary">{workspaceName}</span>
                <PlanBadge plan={workspacePlan} />
              </span>
            </SelectTrigger>
            <WorkplaceSelectorContent workspaces={workspaces} />
          </Select>
          <div className="mt-3 pr-5">
            {action}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AppliedEducationContent
