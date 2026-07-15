'use client'

import type { AgentConfigApiContext } from '../config-context'
import type { AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { downloadUrl } from '@/utils/download'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { AgentSkillDetailDialog } from './detail-dialog'
import { useAgentSkillDetail } from './use-skill-detail'

export function AgentSkillItem({
  apiContext,
  skill,
  onRemove,
}: {
  apiContext: AgentConfigApiContext
  skill: AgentSkill
  onRemove: (skillId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const readOnly = useAgentOrchestrateReadOnly()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const handleRemove = useCallback(() => {
    onRemove(skill.id)
  }, [onRemove, skill.id])
  const handleDownload = useCallback(async () => {
    if (apiContext.workflow) {
      const result = await queryClient.fetchQuery(
        consoleQuery.apps.byAppId.agent.config.skills.byName.download.get.queryOptions({
          input: {
            params: {
              app_id: apiContext.workflow.appId,
              name: skill.name,
            },
            query: {
              node_id: apiContext.workflow.nodeId,
              draft_type: apiContext.draftType,
              version_id: apiContext.versionId,
            },
          },
        }),
      )
      downloadUrl({ url: result.url, fileName: skill.name })
      return
    }

    const result = await queryClient.fetchQuery(
      consoleQuery.agent.byAgentId.config.skills.byName.download.get.queryOptions({
        input: {
          params: {
            agent_id: apiContext.agentId,
            name: skill.name,
          },
          query: {
            draft_type: apiContext.draftType,
            version_id: apiContext.versionId,
          },
        },
      }),
    )
    downloadUrl({ url: result.url, fileName: skill.name })
  }, [apiContext, queryClient, skill.name])
  const handleOpenPreview = useCallback(() => {
    setIsPreviewOpen(true)
  }, [])
  const detail = useAgentSkillDetail({
    apiContext,
    description: skill.description ?? t(($) => $['agentDetail.configure.skills.tip']),
    isOpen: isPreviewOpen,
    skill,
  })

  return (
    <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
      <div className="group relative h-8 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3 focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm has-[[data-agent-skill-remove-button]:focus-visible]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:focus-visible]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:focus-visible]:shadow-xs! has-[[data-agent-skill-remove-button]:hover]:border-state-destructive-border! has-[[data-agent-skill-remove-button]:hover]:bg-state-destructive-hover! has-[[data-agent-skill-remove-button]:hover]:shadow-xs!">
        <button
          type="button"
          aria-label={skill.name}
          className="flex h-full w-full min-w-0 cursor-pointer items-center gap-1 rounded-lg py-1 pr-2.5 pl-2 text-left outline-hidden select-none focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          onClick={handleOpenPreview}
        >
          <span aria-hidden className="i-custom-public-agent-building-blocks size-4 shrink-0" />
          <span className="w-0 min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
            {skill.name}
          </span>
          <span
            className={cn(
              'shrink-0 system-xs-regular text-text-tertiary',
              'group-focus-within:opacity-0 group-hover:opacity-0',
            )}
          >
            {t(($) => $['agentDetail.configure.skills.itemType'])}
          </span>
        </button>
        <button
          type="button"
          aria-label={`${tCommon(($) => $['operation.download'])} ${skill.name}`}
          onClick={handleDownload}
          className={cn(
            'pointer-events-none absolute top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus-visible:bg-state-base-hover focus-visible:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
            readOnly ? 'right-1' : 'right-7',
          )}
        >
          <span aria-hidden className="i-ri-download-line size-4" />
        </button>
        {!readOnly && (
          <button
            type="button"
            data-agent-skill-remove-button
            aria-label={t(($) => $['agentDetail.configure.skills.remove'], { name: skill.name })}
            onClick={handleRemove}
            className="pointer-events-none absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:bg-state-destructive-hover focus-visible:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
          </button>
        )}
      </div>
      {isPreviewOpen && <AgentSkillDetailDialog skillName={skill.name} detail={detail} />}
    </Dialog>
  )
}
