'use client'

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export type AgentSkill = {
  id: string
  name: string
}

export function AgentSkillItem({
  skill,
  onRemove,
}: {
  skill: AgentSkill
  onRemove: (skillId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const handleRemove = useCallback(() => {
    onRemove(skill.id)
  }, [onRemove, skill.id])

  return (
    <div className="group flex h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg py-1 pr-1 pl-2 shadow-xs shadow-shadow-shadow-3 focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm has-[[data-agent-skill-remove-button]:focus-visible]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:focus-visible]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:focus-visible]:shadow-xs! has-[[data-agent-skill-remove-button]:hover]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:hover]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:hover]:shadow-xs!">
      <div className="flex h-full min-w-0 flex-1 items-center gap-1 text-left">
        <span aria-hidden className="i-custom-public-agent-building-blocks size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
          {skill.name}
        </span>
      </div>
      <div className="hidden shrink-0 items-center justify-center rounded-md p-0.5 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          data-agent-skill-remove-button
          aria-label={t('agentDetail.configure.skills.remove', { name: skill.name })}
          onClick={handleRemove}
          className="flex size-5 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:bg-state-destructive-hover focus-visible:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </button>
      </div>
      <div className="flex shrink-0 items-center justify-center group-focus-within:hidden group-hover:hidden">
        <span className="system-xs-regular text-text-tertiary">
          {t('agentDetail.configure.skills.itemType')}
        </span>
      </div>
    </div>
  )
}
