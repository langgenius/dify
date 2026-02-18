import { memo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { useSelector as useAppSelector } from '@/context/app-context'

type TipsProps = {
  showEmailTip: boolean
  isEmailDebugMode: boolean
  showDebugModeTip: boolean
}

const Tips = ({
  showEmailTip,
  isEmailDebugMode,
  showDebugModeTip,
}: TipsProps) => {
  const { t } = useTranslation()
  const email = useAppSelector(s => s.userProfile.email)

  return (
    <>
      <Divider className="!my-2 w-[30px]" />
      <div className="space-y-1 pt-1" data-testid="tips">
        {showEmailTip && !isEmailDebugMode && (
          <div className="text-text-secondary system-xs-regular">{t('common.humanInputEmailTip', { ns: 'workflow' })}</div>
        )}
        {showEmailTip && isEmailDebugMode && (
          <div className="text-text-secondary system-xs-regular">
            <Trans
              i18nKey="common.humanInputEmailTipInDebugMode"
              ns="workflow"
              components={{ email: <span className="system-xs-semibold"></span> }}
              values={{ email }}
            />
          </div>
        )}
        {showDebugModeTip && <div className="text-text-warning system-xs-medium">{t('common.humanInputWebappTip', { ns: 'workflow' })}</div>}
      </div>
    </>
  )
}

export default memo(Tips)
