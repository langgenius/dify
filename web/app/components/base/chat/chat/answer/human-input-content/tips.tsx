import { useSuspenseQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { userProfileQueryOptions } from '@/features/account-profile/client'

type TipsProps = {
  showEmailTip: boolean
  isEmailDebugMode: boolean
  showDebugModeTip: boolean
}

const EmailDebugTip = () => {
  const { data: email } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })

  return (
    <div className="system-xs-regular text-text-secondary">
      <Trans
        i18nKey={($) => $['common.humanInputEmailTipInDebugMode']}
        ns="workflow"
        components={{ email: <span className="system-xs-semibold"></span> }}
        values={{ email }}
      />
    </div>
  )
}

const Tips = ({ showEmailTip, isEmailDebugMode, showDebugModeTip }: TipsProps) => {
  const { t } = useTranslation()

  return (
    <>
      <Divider className="my-2! w-7.5" />
      <div className="space-y-1 pt-1" data-testid="tips">
        {showEmailTip && !isEmailDebugMode && (
          <div className="system-xs-regular text-text-secondary">
            {t(($) => $['common.humanInputEmailTip'], { ns: 'workflow' })}
          </div>
        )}
        {showEmailTip && isEmailDebugMode && <EmailDebugTip />}
        {showDebugModeTip && (
          <div className="system-xs-medium text-text-warning">
            {t(($) => $['common.humanInputWebappTip'], { ns: 'workflow' })}
          </div>
        )}
      </div>
    </>
  )
}

export default memo(Tips)
