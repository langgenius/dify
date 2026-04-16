'use client'
import type { FC } from 'react'
import type { PluginDefaultValue } from '@/app/components/workflow/block-selector/types'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogPortal, DialogTitle } from '@/app/components/base/ui/dialog'
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

  return (
    <Dialog open={isShow} onOpenChange={onClose} disablePointerDismissal>
      <DialogContent
        className="w-[618px] max-w-[618px] rounded-2xl border border-effects-highlight bg-background-default-subtle shadow-lg"
        backdropClassName="bg-workflow-canvas-canvas-overlay"
      >
        <DialogCloseButton />

        <div className="pb-4">
          <div className="mb-6">
            <DialogTitle className="mb-2 title-2xl-semi-bold text-text-primary">
              {t('onboarding.title', { ns: 'workflow' })}
            </DialogTitle>
            <DialogDescription className="body-xs-regular leading-4 text-text-tertiary">
              {t('onboarding.description', { ns: 'workflow' })}
            </DialogDescription>
          </div>

          <StartNodeSelectionPanel
            onSelectUserInput={() => onSelectStartNode(BlockEnum.Start)}
            onSelectTrigger={onSelectStartNode}
          />
        </div>
      </DialogContent>

      {/* TODO: reduce z-1002 to match base/ui primitives after legacy overlay migration completes */}
      <DialogPortal>
        <div className="pointer-events-none fixed top-1/2 left-1/2 z-1002 flex -translate-x-1/2 translate-y-[165px] items-center gap-1 body-xs-regular text-text-quaternary">
          <span>{t('onboarding.escTip.press', { ns: 'workflow' })}</span>
          <ShortcutsName keys={[t('onboarding.escTip.key', { ns: 'workflow' })]} textColor="secondary" />
          <span>{t('onboarding.escTip.toDismiss', { ns: 'workflow' })}</span>
        </div>
      </DialogPortal>
    </Dialog>
  )
}

export default WorkflowOnboardingModal
