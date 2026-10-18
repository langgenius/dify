import { Button } from '@langgenius/dify-ui/button'
import { DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'autoUpdate.pluginDowngradeWarning'

type Props = Readonly<{
  onCancel: () => void
  onJustDowngrade: () => void
  onExcludeAndDowngrade: () => void
}>
const DowngradeWarningModal = ({ onCancel, onJustDowngrade, onExcludeAndDowngrade }: Props) => {
  const { t } = useTranslation(['app', 'plugin'])

  return (
    <>
      <div className="flex flex-col items-start gap-2 self-stretch">
        <DialogTitle>{t(($) => $[`${i18nPrefix}.title`], { ns: 'plugin' })}</DialogTitle>
        <div className="system-md-regular text-text-secondary">
          {t(($) => $[`${i18nPrefix}.description`], { ns: 'plugin' })}
        </div>
      </div>
      <div className="mt-9 flex items-start justify-end space-x-2 self-stretch">
        <Button variant="secondary" onClick={() => onCancel()}>
          {t(($) => $['newApp.Cancel'], { ns: 'app' })}
        </Button>
        <Button variant="secondary" tone="destructive" onClick={onJustDowngrade}>
          {t(($) => $[`${i18nPrefix}.downgrade`], { ns: 'plugin' })}
        </Button>
        <Button variant="primary" onClick={onExcludeAndDowngrade}>
          {t(($) => $[`${i18nPrefix}.exclude`], { ns: 'plugin' })}
        </Button>
      </div>
    </>
  )
}

export default DowngradeWarningModal
