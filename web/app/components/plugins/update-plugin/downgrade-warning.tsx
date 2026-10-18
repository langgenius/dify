import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'autoUpdate.pluginDowngradeWarning'

type Props = Readonly<{
  excluding: boolean
  downgrading: boolean
  onJustDowngrade: () => void
  onExcludeAndDowngrade: () => void
}>
const DowngradeWarningContent = ({
  excluding,
  downgrading,
  onJustDowngrade,
  onExcludeAndDowngrade,
}: Props) => {
  const { t } = useTranslation(['app', 'plugin', 'common'])

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t(($) => $[`${i18nPrefix}.title`], { ns: 'plugin' })}</AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $[`${i18nPrefix}.description`], { ns: 'plugin' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={excluding || downgrading}>
          {t(($) => $['newApp.Cancel'], { ns: 'app' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          variant="secondary"
          tone="destructive"
          disabled={excluding}
          loading={downgrading}
          onClick={onJustDowngrade}
        >
          {t(($) => $[`${i18nPrefix}.downgrade`], { ns: 'plugin' })}
        </AlertDialogConfirmButton>
        <AlertDialogConfirmButton
          variant="primary"
          tone="default"
          disabled={downgrading}
          loading={excluding}
          onClick={onExcludeAndDowngrade}
        >
          {t(($) => $[`${i18nPrefix}.exclude`], { ns: 'plugin' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}

export default DowngradeWarningContent
