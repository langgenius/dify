'use client'

import type { AgentDriveApiContext } from '../drive-context'
import type { AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import {
  Dialog,
} from '@langgenius/dify-ui/dialog'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { AgentSkillDetailDialog } from './detail-dialog'
import { useAgentSkillDetail } from './use-skill-detail'

export function AgentSkillItem({
  apiContext,
  skill,
  onRemove,
}: {
  apiContext: AgentDriveApiContext
  skill: AgentSkill
  onRemove: (skillId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const handleRemove = useCallback(() => {
    onRemove(skill.id)
  }, [onRemove, skill.id])
  const handleOpenPreview = useCallback(() => {
    setIsPreviewOpen(true)
  }, [])
  const detail = useAgentSkillDetail({
    apiContext,
    description: skill.description ?? t('agentDetail.configure.skills.tip'),
    isOpen: isPreviewOpen,
    skill,
  })

  return (
    <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
      <div className="group flex h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg py-1 pr-2.5 pl-2 shadow-xs shadow-shadow-shadow-3 focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:bg-components-panel-on-panel-item-bg-hover hover:pr-1 hover:shadow-sm has-[[data-agent-skill-remove-button]:focus-visible]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:focus-visible]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:focus-visible]:shadow-xs! has-[[data-agent-skill-remove-button]:hover]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:hover]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:hover]:shadow-xs!">
        <button
          type="button"
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={handleOpenPreview}
        >
          <span aria-hidden className="i-custom-public-agent-building-blocks size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
            {skill.name}
          </span>
        </button>
        {!readOnly && (
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
        )}
        <div className="flex shrink-0 items-center justify-center group-focus-within:hidden group-hover:hidden">
          <span className="system-xs-regular text-text-tertiary">
            {t('agentDetail.configure.skills.itemType')}
          </span>
        </div>
      </div>
      {isPreviewOpen && (
        <AgentSkillDetailDialog
          skillName={skill.name}
          detail={detail}
        />
      )}
    </Dialog>
  )
}
