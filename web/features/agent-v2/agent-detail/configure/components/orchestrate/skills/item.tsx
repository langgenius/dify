'use client'

import type { AgentConfigApiContext } from '../config-context'
import type { AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { downloadUrl } from '@/utils/download'
import { MissingReferenceWarning } from '../common/missing-reference-warning'
import { AgentSkillDetailDialog } from './detail-dialog'
import { useAgentSkillDetail } from './use-skill-detail'

export function AgentSkillItem({
  apiContext,
  canRemove,
  skill,
  onRemove,
}: {
  apiContext: AgentConfigApiContext
  canRemove: boolean
  skill: AgentSkill
  onRemove: (skillId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const [isRemoveHighlighted, setIsRemoveHighlighted] = useState(false)
  const handleRemove = useCallback(() => {
    onRemove(skill.id)
  }, [onRemove, skill.id])
  const handleDownload = useCallback(async () => {
    if (skill.isMissing) return

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
  }, [apiContext, queryClient, skill.isMissing, skill.name])
  const handleOpenPreview = useCallback(() => {
    if (skill.isMissing) return

    setIsPreviewOpen(true)
  }, [skill.isMissing])
  const detail = useAgentSkillDetail({
    apiContext,
    description: skill.description ?? t(($) => $['agentDetail.configure.skills.tip']),
    isOpen: isPreviewOpen,
    skill,
  })

  return (
    <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
      <div
        data-agent-skill-row
        className={cn(
          'group relative h-8 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3 focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
          isRemoveHighlighted &&
            'border-state-destructive-border! bg-state-destructive-hover! shadow-xs!',
        )}
      >
        <button
          type="button"
          aria-label={skill.name}
          disabled={skill.isMissing}
          className="flex h-full w-full min-w-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-left outline-hidden select-none focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid disabled:cursor-default"
          onClick={handleOpenPreview}
        >
          <span
            aria-hidden
            className="i-custom-vender-agent-v2-building-blocks size-4 shrink-0 text-text-secondary"
          />
          <span className="w-0 min-w-0 flex-1 truncate system-sm-medium text-text-secondary decoration-divider-deep decoration-dotted group-focus-within:underline group-hover:underline">
            {skill.name}
          </span>
          {skill.isMissing ? (
            <span aria-hidden className="size-4 shrink-0" />
          ) : (
            <span
              className={cn(
                'shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary group-focus-within:opacity-0 group-hover:opacity-0',
                isActionsOpen && 'opacity-0',
              )}
            >
              {t(($) => $['agentDetail.configure.skills.addMenu.upload.badge'])}
            </span>
          )}
        </button>
        {skill.isMissing && (
          <MissingReferenceWarning
            className="absolute top-1/2 right-1 -translate-y-1/2"
            label={t(($) => $['agentDetail.configure.skills.missing'])}
          />
        )}
        {(!skill.isMissing || canRemove) && (
          <DropdownMenu
            modal={false}
            onOpenChange={(open) => {
              setIsActionsOpen(open)
              if (!open) setIsRemoveHighlighted(false)
            }}
          >
            <DropdownMenuTrigger
              data-agent-skill-actions
              aria-label={t(($) => $['agentDetail.configure.skills.moreActions'], {
                name: skill.name,
              })}
              className={cn(
                'pointer-events-none absolute top-1/2 right-1 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:pointer-events-auto data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary data-popup-open:opacity-100',
                isRemoveHighlighted && 'text-text-destructive!',
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <span aria-hidden className="i-ri-more-fill size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-48">
              {!skill.isMissing && (
                <DropdownMenuItem className="gap-2" onClick={handleDownload}>
                  <span
                    aria-hidden
                    className="i-ri-download-line size-4 shrink-0 text-text-tertiary"
                  />
                  <span>{tCommon(($) => $['operation.download'])}</span>
                </DropdownMenuItem>
              )}
              {!skill.isMissing && canRemove && <DropdownMenuSeparator />}
              {canRemove && (
                <DropdownMenuItem
                  data-agent-skill-remove-button
                  className="group gap-2 data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive"
                  onClick={handleRemove}
                  onFocus={() => setIsRemoveHighlighted(true)}
                  onBlur={() => setIsRemoveHighlighted(false)}
                  onMouseEnter={() => setIsRemoveHighlighted(true)}
                  onMouseLeave={() => setIsRemoveHighlighted(false)}
                >
                  <span
                    aria-hidden
                    className="i-ri-delete-bin-line size-4 shrink-0 text-text-tertiary group-data-highlighted:text-text-destructive"
                  />
                  <span>{tCommon(($) => $['operation.delete'])}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {isPreviewOpen && <AgentSkillDetailDialog skillName={skill.name} detail={detail} />}
    </Dialog>
  )
}
