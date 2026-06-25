import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlDivider, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'

type AgentConfigureRightPanelMode = 'build' | 'preview'

export function AgentPreviewHeader({
  mode,
  previewEnabled,
  isChatFeaturesOpen,
  onModeChange,
  onToggleChatFeatures,
  onOpenVersions,
  onRefresh,
  refreshDisabled,
}: {
  mode: AgentConfigureRightPanelMode
  previewEnabled: boolean
  isChatFeaturesOpen: boolean
  onModeChange: (mode: AgentConfigureRightPanelMode) => void
  onToggleChatFeatures: () => void
  onOpenVersions: () => void
  onRefresh: () => void
  refreshDisabled?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const modeTipTitle = t(`agentDetail.configure.rightPanel.${mode}TipTitle`)
  const modeTipBody = t(`agentDetail.configure.rightPanel.${mode}TipBody`)
  const modeTip = `${modeTipTitle}. ${modeTipBody}`

  return (
    <div className="relative z-1 flex h-12 shrink-0 items-center gap-3 py-2 pr-3 pl-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SegmentedControl<AgentConfigureRightPanelMode>
          value={[mode]}
          onValueChange={(value) => {
            const nextMode = value[0]
            if (nextMode && (nextMode !== 'preview' || previewEnabled))
              onModeChange(nextMode)
          }}
          aria-label={t('agentDetail.configure.rightPanel.modeLabel')}
        >
          <SegmentedControlItem<AgentConfigureRightPanelMode> value="build" className="uppercase">
            <span aria-hidden className="i-ri-hammer-line size-4" />
            {t('agentDetail.configure.rightPanel.build')}
          </SegmentedControlItem>
          <SegmentedControlItem<AgentConfigureRightPanelMode>
            value="preview"
            disabled={!previewEnabled}
            className="uppercase"
          >
            <span aria-hidden className="i-custom-vender-other-replay-line size-4" />
            {t('agentDetail.configure.rightPanel.preview')}
          </SegmentedControlItem>
        </SegmentedControl>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={modeTip}
                className="flex size-5 shrink-0 items-center justify-center rounded-md text-text-quaternary hover:bg-state-base-hover hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              >
                <span aria-hidden className="i-ri-question-line size-4" />
              </button>
            )}
          />
          <TooltipContent className="max-w-64">
            <div className="system-xs-semibold text-text-primary">{modeTipTitle}</div>
            <div className="mt-1 system-xs-regular text-text-secondary">{modeTipBody}</div>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled}
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
