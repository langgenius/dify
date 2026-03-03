'use client'
import type { FC } from 'react'
import type { PluginDefaultValue } from '@/app/components/workflow/block-selector/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogCloseButton, DialogContent, DialogPortal } from '@/app/components/base/ui/dialog'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { BlockEnum } from '@/app/components/workflow/types'
import StartNodeSelectionPanel from './start-node-selection-panel'

type WorkflowOnboardingModalProps = {
  isShow: boolean
  onClose: () => void
  onSelectStartNode: (nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => void
}

const WorkflowOnboardingModal: FC<WorkflowOnboardingModalProps> = ({
  isShow,
  onClose,
  onSelectStartNode,
}) => {
  const { t } = useTranslation()

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open)
      onClose()
  }, [onClose])

  const handleSelectUserInput = useCallback(() => {
    onSelectStartNode(BlockEnum.Start)
    onClose()
  }, [onSelectStartNode, onClose])

  const handleTriggerSelect = useCallback((nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => {
    onSelectStartNode(nodeType, toolConfig)
    onClose()
  }, [onSelectStartNode, onClose])

  return (
    <Dialog open={isShow} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent
        className="w-[618px] max-w-[618px] rounded-2xl border border-effects-highlight bg-background-default-subtle shadow-lg"
        overlayClassName="bg-workflow-canvas-canvas-overlay"
      >
        <DialogCloseButton />

        <div className="pb-4">
          <div className="mb-6">
            <h3 className="mb-2 text-text-primary title-2xl-semi-bold">
              {t('onboarding.title', { ns: 'workflow' })}
            </h3>
            <div className="leading-4 text-text-tertiary body-xs-regular">
              {t('onboarding.description', { ns: 'workflow' })}
            </div>
          </div>

          <StartNodeSelectionPanel
            onSelectUserInput={handleSelectUserInput}
            onSelectTrigger={handleTriggerSelect}
          />
        </div>
      </DialogContent>

      <DialogPortal>
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 translate-y-[165px] items-center gap-1 text-text-quaternary body-xs-regular">
          <span>{t('onboarding.escTip.press', { ns: 'workflow' })}</span>
          <ShortcutsName keys={[t('onboarding.escTip.key', { ns: 'workflow' })]} textColor="secondary" />
          <span>{t('onboarding.escTip.toDismiss', { ns: 'workflow' })}</span>
        </div>
      </DialogPortal>
    </Dialog>
  )
}

export default WorkflowOnboardingModal
