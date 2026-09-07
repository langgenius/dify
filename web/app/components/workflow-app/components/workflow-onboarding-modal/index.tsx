'use client'
import type { FC } from 'react'
import type { BlockDefaultValue } from '@/app/components/workflow/block-selector/types'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { BlockEnum } from '@/app/components/workflow/types'
import StartNodeSelectionPanel from './start-node-selection-panel'

type WorkflowOnboardingModalProps = {
  isShow: boolean
  onClose: () => void
  onSelectStartNode: (nodeType: BlockEnum, toolConfig?: BlockDefaultValue) => void
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
        className="w-154.5 max-w-154.5 rounded-2xl border border-effects-highlight bg-background-default-subtle shadow-lg"
        backdropProps={{ className: 'bg-workflow-canvas-canvas-overlay' }}
      >
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />

        <div className="pb-4">
          <div className="mb-6">
            <DialogTitle className="mb-2 title-2xl-semi-bold text-text-primary">
              {t(($) => $['onboarding.title'], { ns: 'workflow' })}
            </DialogTitle>
            <DialogDescription className="body-xs-regular leading-4 text-text-tertiary">
              {t(($) => $['onboarding.description'], { ns: 'workflow' })}
            </DialogDescription>
          </div>

          <StartNodeSelectionPanel
            onSelectUserInput={() => onSelectStartNode(BlockEnum.Start)}
            onSelectTrigger={onSelectStartNode}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default WorkflowOnboardingModal
