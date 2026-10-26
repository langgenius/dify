'use client'
import type { FC } from 'react'
import type { BlockDefaultValue } from '@/app/components/workflow/block-selector/types'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
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
  const { t } = useTranslation(['common', 'workflow'])

  return (
    <Dialog open={isShow} onOpenChange={onClose} disablePointerDismissal>
      <DialogContent
        className="w-154.5 max-w-154.5"
        backdropProps={{ className: 'bg-workflow-canvas-canvas-overlay' }}
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $['onboarding.title'], { ns: 'workflow' })}</DialogTitle>
          <DialogDescription>
            {t(($) => $['onboarding.description'], { ns: 'workflow' })}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>

        <DialogBody>
          <StartNodeSelectionPanel
            onSelectUserInput={() => onSelectStartNode(BlockEnum.Start)}
            onSelectTrigger={onSelectStartNode}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

export default WorkflowOnboardingModal
