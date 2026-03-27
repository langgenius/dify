import type { FC } from 'react'
import type { AppPublisherMenuContentProps } from './menu-content.types'
import { useTranslation } from 'react-i18next'
import { AccessModeDisplay } from './menu-content-shared'

type MenuContentAccessSectionProps = Pick<
  AppPublisherMenuContentProps,
  | 'appDetail'
  | 'isAppAccessSet'
  | 'onShowAppAccessControl'
  | 'systemFeatures'
>

const MenuContentAccessSection: FC<MenuContentAccessSectionProps> = ({
  appDetail,
  isAppAccessSet,
  onShowAppAccessControl,
  systemFeatures,
}) => {
  const { t } = useTranslation()

  if (!systemFeatures.webapp_auth.enabled)
    return null

  return (
    <div className="p-4 pt-3">
      <div className="flex h-6 items-center">
        <p className="text-text-tertiary system-xs-medium">{t('publishApp.title', { ns: 'app' })}</p>
      </div>
      <div
        className="flex h-8 cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pl-2.5 pr-2 hover:bg-primary-50 hover:text-text-accent"
        onClick={onShowAppAccessControl}
      >
        <div className="flex grow items-center gap-x-1.5 overflow-hidden pr-1">
          <AccessModeDisplay mode={appDetail?.access_mode} />
        </div>
        {!isAppAccessSet && <p className="shrink-0 text-text-tertiary system-xs-regular">{t('publishApp.notSet', { ns: 'app' })}</p>}
        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
          <span className="i-ri-arrow-right-s-line h-4 w-4 text-text-quaternary" />
        </div>
      </div>
      {!isAppAccessSet && <p className="mt-1 text-text-warning system-xs-regular">{t('publishApp.notSetDesc', { ns: 'app' })}</p>}
    </div>
  )
}

export default MenuContentAccessSection
