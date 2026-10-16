import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

export function RestoreVersionDialogContent({
  isPending,
  onConfirm,
  versionTitle,
}: {
  isPending: boolean
  onConfirm: () => void
  versionTitle: string
}) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $['skillManagement.detail.restoreVersionConfirmTitle'])}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['skillManagement.detail.restoreVersionConfirmDescription'], {
            version: versionTitle,
          })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {tCommon(($) => $['operation.cancel'])}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton tone="default" loading={isPending} onClick={onConfirm}>
          {t(($) => $['skillManagement.detail.restoreVersion'])}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
