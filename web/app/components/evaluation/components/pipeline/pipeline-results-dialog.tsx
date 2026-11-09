'use client'

import type { RefObject } from 'react'
import type { EvaluationResourceProps } from '../../types'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import PipelineResultsPreview from './pipeline-results-preview'

type PipelineResultsDialogProps = EvaluationResourceProps & {
  runId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus returns on close, since the dialog is opened from state, not a trigger. */
  finalFocus?: RefObject<HTMLElement | null>
}

const PipelineResultsDialog = ({
  resourceType,
  resourceId,
  runId,
  open,
  onOpenChange,
  finalFocus,
}: PipelineResultsDialogProps) => {
  const { t } = useTranslation(['evaluation', 'common'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-180 max-h-[80dvh] w-240 overflow-hidden" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t(($) => $['results.title'], { ns: 'evaluation' })}</DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="flex flex-col">
          {runId && (
            <PipelineResultsPreview
              key={runId}
              resourceType={resourceType}
              resourceId={resourceId}
              runId={runId}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

export default PipelineResultsDialog
