'use client'

import type { AgentSkillDetail } from './agent-skill-detail-dialog'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { AgentSkillDetailDialog } from './agent-skill-detail-dialog'

export type AgentSkill = {
  id: string
  name: string
}

export type AgentSkillWithDetail = AgentSkill & {
  detail: AgentSkillDetail
}

export function AgentSkillItem({
  skill,
}: {
  skill: AgentSkillWithDetail
}) {
  const { t } = useTranslation('agentV2')

  return (
    <Dialog>
      <div className="group flex h-8 items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3 hover:bg-state-base-hover hover:shadow-sm">
        <DialogTrigger
          render={(
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-l-lg px-2 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
            />
          )}
        >
          <span aria-hidden className="i-custom-public-agent-building-blocks size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
            {skill.name}
          </span>
        </DialogTrigger>
        <div className="relative mr-1 flex h-5 w-8 shrink-0 items-center justify-center">
          <button
            type="button"
            aria-label={t('agentDetail.configure.skills.remove', { name: skill.name })}
            className="peer pointer-events-none absolute z-10 flex size-5 items-center justify-center rounded-md text-text-tertiary opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-delete-bin-line size-3.5" />
          </button>
          <span className="system-xs-regular text-text-tertiary group-hover:invisible peer-focus-visible:invisible">
            {t('agentDetail.configure.skills.itemType')}
          </span>
        </div>
      </div>
      <AgentSkillDetailDialog skillName={skill.name} detail={skill.detail} />
    </Dialog>
  )
}
