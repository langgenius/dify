import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { SegmentedControl, SegmentedControlDivider, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
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

function ModeInfoTip({
  children,
  ariaLabel,
}: {
  children: ReactNode
  ariaLabel: string
}) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        aria-label={ariaLabel}
        onClick={handleClick}
        className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span aria-hidden className="i-ri-question-line size-4 text-text-tertiary hover:text-text-secondary" />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom"
        sideOffset={2}
        popupClassName="w-60 max-w-60 rounded-xl bg-components-tooltip-bg px-4 py-3.5 text-start text-text-secondary backdrop-blur-[5px]"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

function PreviewModeItem({
  previewEnabled,
  disabledTip,
  children,
}: {
  previewEnabled: boolean
  disabledTip: string
  children: ReactNode
}) {
  const item = (
    <SegmentedControlItem<AgentConfigureRightPanelMode>
      value="preview"
      disabled={!previewEnabled}
      className="uppercase"
    >
      {children}
    </SegmentedControlItem>
  )

  if (previewEnabled)
    return item

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        nativeButton={false}
        aria-label={disabledTip}
        render={<span className="inline-flex" />}
      >
        {item}
      </PopoverTrigger>
      <PopoverContent
        placement="bottom"
        sideOffset={6}
        popupClassName="max-w-[260px] rounded-md bg-components-tooltip-bg px-3 py-2 system-xs-regular text-text-tertiary shadow-lg"
      >
        {disabledTip}
      </PopoverContent>
    </Popover>
  )
}

export function AgentPreviewHeader({
  mode,
  previewEnabled,
  isChatFeaturesOpen,
  onModeChange,
  onToggleChatFeatures,
  onOpenWorkingDirectory,
  onRefresh,
  refreshDisabled,
  showWorkingDirectoryAction = false,
  showChatFeaturesAction = true,
  trailingAction,
}: {
  mode: AgentConfigureRightPanelMode
  previewEnabled: boolean
  isChatFeaturesOpen: boolean
  onModeChange: (mode: AgentConfigureRightPanelMode) => void
  onToggleChatFeatures: () => void
  onOpenWorkingDirectory: () => void
  onRefresh: () => void
  refreshDisabled?: boolean
  showWorkingDirectoryAction?: boolean
  showChatFeaturesAction?: boolean
  trailingAction?: ReactNode
}) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const buildLabel = t('agentDetail.configure.rightPanel.build')
  const buildTipBody = t('agentDetail.configure.rightPanel.buildTipBody')
  const previewLabel = t('agentDetail.configure.rightPanel.preview')
  const previewTipBody = t('agentDetail.configure.rightPanel.previewTipBody')
  const previewDisabledTip = t('agentDetail.configure.rightPanel.previewDisabledTip')
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
          <PreviewModeItem previewEnabled={previewEnabled} disabledTip={previewDisabledTip}>
            <span aria-hidden className="i-custom-vender-agent-v2-configure-preview size-4" />
            {t('agentDetail.configure.rightPanel.preview')}
          </PreviewModeItem>
        </SegmentedControl>
        <ModeInfoTip ariaLabel={modeTip}>
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
        </ModeInfoTip>
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
          {mode === 'build' && showWorkingDirectoryAction && (
            <button
              type="button"
              onClick={onOpenWorkingDirectory}
              className="flex h-8 items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              aria-label={t('agentDetail.configure.workingDirectory.open')}
            >
              <span aria-hidden className="i-ri-folder-3-line size-4" />
              <span className="px-0.5 system-sm-medium">{t('agentDetail.configure.workingDirectory.fileSystem')}</span>
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
        {trailingAction != null && (
          <>
            <SegmentedControlDivider className="mx-3" />
            {trailingAction}
          </>
        )}
      </div>
    </div>
  )
}
