'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

export function KnowledgeModelSetupDialog({
  onConfigure,
  onOpenChange,
  open,
}: {
  onConfigure: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="px-6 pt-6">
          <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
            {tCommon(($) => $['modelProvider.toBeConfigured'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
            {tCommon(($) => $['modelProvider.systemReasoningModel.key'])}
            {' · '}
            {tSettings(($) => $['form.embeddingModel'])}
            {' · '}
            {tCommon(($) => $['modelProvider.rerankModel.key'])}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton>{tCommon(($) => $['operation.cancel'])}</AlertDialogCancelButton>
          <AlertDialogConfirmButton tone="default" onClick={onConfigure}>
            {tCommon(($) => $['modelProvider.selector.configure'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
