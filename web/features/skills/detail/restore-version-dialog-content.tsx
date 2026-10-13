import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
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
    <AlertDialogContent className="p-6">
      <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
        {t(($) => $['skillManagement.detail.restoreVersionConfirmTitle'])}
      </AlertDialogTitle>
      <AlertDialogDescription className="mt-2 system-md-regular whitespace-pre-line text-text-tertiary">
        {t(($) => $['skillManagement.detail.restoreVersionConfirmDescription'], {
          version: versionTitle,
        })}
      </AlertDialogDescription>
      <AlertDialogFooter className="p-0 pt-6">
        <AlertDialogCancelButton disabled={isPending}>
          {tCommon(($) => $['operation.cancel'])}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton loading={isPending} onClick={onConfirm}>
          {t(($) => $['skillManagement.detail.restoreVersion'])}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
