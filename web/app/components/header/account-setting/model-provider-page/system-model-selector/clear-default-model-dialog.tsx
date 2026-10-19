import type { AlertDialogContentProps } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

type ClearDefaultModelDialogProps = {
  open: boolean
  modelName: string
  disabled: boolean
  finalFocus: AlertDialogContentProps['finalFocus']
  onConfirm: () => void
  onClose: () => void
  onCloseComplete: () => void
}

const ClearDefaultModelDialog = ({
  open,
  modelName,
  disabled,
  finalFocus,
  onConfirm,
  onClose,
  onCloseComplete,
}: ClearDefaultModelDialogProps) => {
  const { t } = useTranslation(['common', 'modelProvider'])

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onCloseComplete()
      }}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['modelProvider.clearDefaultModel.title'], {
              ns: 'modelProvider',
              modelType: modelName,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['modelProvider.clearDefaultModel.description'], {
              ns: 'modelProvider',
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton disabled={disabled} onClick={onConfirm}>
            {t(($) => $['operation.clear'], { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default ClearDefaultModelDialog
