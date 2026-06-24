'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlDivider, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type AgentConfigureRightPanelMode = 'build' | 'preview'

export function AgentPreviewHeader({
  agentId,
  mode,
  isChatFeaturesOpen,
  onModeChange,
  onToggleChatFeatures,
  onOpenVersions,
  onRestart,
}: {
  agentId: string
  mode: AgentConfigureRightPanelMode
  isChatFeaturesOpen: boolean
  onModeChange: (mode: AgentConfigureRightPanelMode) => void
  onToggleChatFeatures: () => void
  onOpenVersions: () => void
  onRestart: () => void
}) {
  const { t } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const refreshDebugConversationMutation = useMutation(consoleQuery.agent.byAgentId.debugConversation.refresh.post.mutationOptions({
    onSuccess: ({ debug_conversation_id }) => {
      queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
        consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
        (agentDetail) => {
          if (!agentDetail)
            return agentDetail

          return {
            ...agentDetail,
            debug_conversation_id,
          }
        },
      )
      onRestart()
    },
  }))

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 py-2 pr-3 pl-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SegmentedControl<AgentConfigureRightPanelMode>
          value={[mode]}
          onValueChange={(value) => {
            const nextMode = value[0]
            if (nextMode)
              onModeChange(nextMode)
          }}
          aria-label={t('agentDetail.configure.rightPanel.modeLabel')}
        >
          <SegmentedControlItem<AgentConfigureRightPanelMode> value="build" className="uppercase">
            <span aria-hidden className="i-ri-hammer-line size-4" />
            {t('agentDetail.configure.rightPanel.build')}
          </SegmentedControlItem>
          <SegmentedControlItem<AgentConfigureRightPanelMode> value="preview" className="uppercase">
            <span aria-hidden className="i-custom-vender-other-replay-line size-4" />
            {t('agentDetail.configure.rightPanel.preview')}
          </SegmentedControlItem>
        </SegmentedControl>
        <span aria-hidden className="i-ri-question-line size-4 shrink-0 text-text-quaternary" />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => refreshDebugConversationMutation.mutate({
            params: {
              agent_id: agentId,
            },
          })}
          disabled={refreshDebugConversationMutation.isPending}
          className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('agentDetail.configure.preview.restart')}
        >
          <span aria-hidden className="i-custom-vender-other-replay-line size-4" />
        </button>
        {mode === 'build'
          ? (
              <button
                type="button"
                onClick={onOpenVersions}
                className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                aria-label={t('agentDetail.configure.publishBar.versionHistory')}
              >
                <span aria-hidden className="i-ri-folder-3-line size-4" />
              </button>
            )
          : (
              <>
                <SegmentedControlDivider className="mx-1" />
                <button
                  type="button"
                  aria-pressed={isChatFeaturesOpen}
                  onClick={onToggleChatFeatures}
                  className={cn(
                    'flex h-8 items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                    isChatFeaturesOpen && 'bg-state-base-hover text-text-secondary',
                  )}
                  aria-label={t('agentDetail.configure.preview.chatFeatures')}
                >
                  <span aria-hidden className="i-ri-apps-2-add-line size-4" />
                  <span className="px-0.5 system-sm-medium">{t('agentDetail.configure.preview.chatFeatures')}</span>
                </button>
              </>
            )}
      </div>
    </div>
  )
}
