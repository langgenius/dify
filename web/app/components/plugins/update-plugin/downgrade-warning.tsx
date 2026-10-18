import { Button } from '@langgenius/dify-ui/button'
import {
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'autoUpdate.pluginDowngradeWarning'

type Props = Readonly<{
  onCancel: () => void
  onJustDowngrade: () => void
  onExcludeAndDowngrade: () => void
}>
const DowngradeWarningModal = ({ onCancel, onJustDowngrade, onExcludeAndDowngrade }: Props) => {
  const { t } = useTranslation(['app', 'plugin', 'common'])

  return (
    <>
      <DialogHeader
        // oxlint-disable-next-line shadcn/no-restyle -- Preserve the warning's 8px title-to-description gap.
        className="pb-2"
      >
        <DialogTitle>{t(($) => $[`${i18nPrefix}.title`], { ns: 'plugin' })}</DialogTitle>
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>
      <div className="px-6 pb-4 system-md-regular text-text-secondary">
        {t(($) => $[`${i18nPrefix}.description`], { ns: 'plugin' })}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onCancel()}>
          {t(($) => $['newApp.Cancel'], { ns: 'app' })}
        </Button>
        <Button variant="secondary" tone="destructive" onClick={onJustDowngrade}>
          {t(($) => $[`${i18nPrefix}.downgrade`], { ns: 'plugin' })}
        </Button>
        <Button variant="primary" onClick={onExcludeAndDowngrade}>
          {t(($) => $[`${i18nPrefix}.exclude`], { ns: 'plugin' })}
        </Button>
      </DialogFooter>
    </>
  )
}

export default DowngradeWarningModal
