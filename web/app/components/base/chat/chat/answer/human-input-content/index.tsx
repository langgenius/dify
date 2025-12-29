import type { HumanInputContentProps } from './type'
import { Trans, useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { useSelector as useAppSelector } from '@/context/app-context'
import HumanInputForm from './human-input-form'

const HumanInputContent = ({
  formData,
  showEmailTip = false,
  isEmailDebugMode = false,
  showDebugModeTip = false,
  showTimeout = false,
  onSubmit,
}: HumanInputContentProps) => {
  const { t } = useTranslation()
  const email = useAppSelector(s => s.userProfile.email)

  return (
    <>
      <HumanInputForm
        formData={formData}
        showTimeout={showTimeout}
        onSubmit={onSubmit}
      />
      {(showEmailTip || showDebugModeTip) && (
        <>
          <Divider className="!my-2 w-[30px]" />
          <div className="space-y-1 pt-1">
            {showEmailTip && !isEmailDebugMode && (
              <div className="system-xs-regular text-text-secondary">{t('common.humanInputEmailTip', { ns: 'workflow' })}</div>
            )}
            {showEmailTip && isEmailDebugMode && (
              <div className="system-xs-regular text-text-secondary">
                <Trans
                  i18nKey="workflow.common.humanInputEmailTipInDebugMode"
                  components={{ email: <span className="system-xs-semibold"></span> }}
                  values={{ email }}
                />
              </div>
            )}
            {showDebugModeTip && <div className="system-xs-medium text-text-warning">{t('common.humanInputWebappTip', { ns: 'workflow' })}</div>}
          </div>
        </>
      )}
    </>
  )
}

export default HumanInputContent
