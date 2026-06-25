import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlDivider, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { useDocLink } from '@/context/i18n'

type AgentConfigureRightPanelMode = 'build' | 'preview'

function AgentModeTipSection({
  iconClassName,
  title,
  children,
}: {
  iconClassName: string
  title: string
  children: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-1.5">
        <span aria-hidden className={cn('size-4 shrink-0 text-text-primary', iconClassName)} />
        <div className="system-sm-medium-uppercase text-text-primary">{title}</div>
      </div>
      <div className="system-xs-regular text-text-secondary">{children}</div>
    </div>
  )
}

export function AgentPreviewHeader({
  mode,
  previewEnabled,
  isChatFeaturesOpen,
  onModeChange,
  onToggleChatFeatures,
  onOpenVersions,
  onRefresh,
  refreshDisabled,
  showChatFeaturesAction = true,
}: {
  mode: AgentConfigureRightPanelMode
  previewEnabled: boolean
  isChatFeaturesOpen: boolean
  onModeChange: (mode: AgentConfigureRightPanelMode) => void
  onToggleChatFeatures: () => void
  onOpenVersions: () => void
  onRefresh: () => void
  refreshDisabled?: boolean
  showChatFeaturesAction?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const buildLabel = t('agentDetail.configure.rightPanel.build')
  const buildTipBody = t('agentDetail.configure.rightPanel.buildTipBody')
  const previewLabel = t('agentDetail.configure.rightPanel.preview')
  const previewTipBody = t('agentDetail.configure.rightPanel.previewTipBody')
  const learnMoreLabel = t('agentDetail.configure.rightPanel.learnMore')
  const modeTip = `${buildLabel}. ${buildTipBody} ${previewLabel}. ${previewTipBody} ${learnMoreLabel}`

  return (
    <div className="relative z-1 flex h-12 shrink-0 items-center justify-between gap-3 px-4 py-2">
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
            <span aria-hidden className="i-custom-vender-agent-v2-configure-build size-4" />
            {t('agentDetail.configure.rightPanel.build')}
          </SegmentedControlItem>
          <SegmentedControlItem<AgentConfigureRightPanelMode>
            value="preview"
            disabled={!previewEnabled}
            className="uppercase"
          >
            <span aria-hidden className="i-custom-vender-agent-v2-configure-preview size-4" />
            {t('agentDetail.configure.rightPanel.preview')}
          </SegmentedControlItem>
        </SegmentedControl>
        <Infotip
          aria-label={modeTip}
          placement="bottom"
          sideOffset={2}
          className="size-5 rounded-md"
          iconClassName="size-4 text-text-tertiary"
          popupClassName="w-60 max-w-60 rounded-xl bg-components-tooltip-bg px-4 py-3.5 text-start text-text-secondary backdrop-blur-[5px]"
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-3">
              <AgentModeTipSection iconClassName="i-custom-vender-agent-v2-configure-build" title={buildLabel}>
                {buildTipBody}
              </AgentModeTipSection>
              <AgentModeTipSection iconClassName="i-custom-vender-agent-v2-configure-preview" title={previewLabel}>
                {previewTipBody}
              </AgentModeTipSection>
            </div>
            <a
              href={docLink('/use-dify/build/agent')}
              target="_blank"
              rel="noopener noreferrer"
              className="body-xs-regular text-text-accent hover:underline"
            >
              {learnMoreLabel}
            </a>
          </div>
        </Infotip>
      </div>
      <div className="flex shrink-0 items-center">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshDisabled}
            className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('agentDetail.configure.preview.restart')}
          >
            <span aria-hidden className="i-custom-vender-other-replay-line size-4" />
          </button>
          {mode === 'build' && (
            <button
              type="button"
              onClick={onOpenVersions}
              className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              aria-label={t('agentDetail.configure.publishBar.versionHistory')}
            >
              <span aria-hidden className="i-ri-folder-3-line size-4" />
            </button>
          )}
        </div>
        {showChatFeaturesAction && (
          <>
            <SegmentedControlDivider className="mx-3" />
            <button
              type="button"
              aria-pressed={isChatFeaturesOpen}
              onClick={onToggleChatFeatures}
              className={cn(
                'flex h-8 items-center justify-center gap-1 rounded-lg px-2 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                isChatFeaturesOpen && 'bg-state-base-hover text-text-secondary',
              )}
              aria-label={t('agentDetail.configure.preview.chatFeatures')}
            >
              <span aria-hidden className="i-ri-chat-settings-line size-4" />
              <span className="px-0.5 system-sm-medium">{t('agentDetail.configure.preview.chatFeatures')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
