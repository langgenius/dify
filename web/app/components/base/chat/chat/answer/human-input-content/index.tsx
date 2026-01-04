import type { HumanInputContentProps } from './type'
import { Trans, useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import { useSelector as useAppSelector } from '@/context/app-context'
import ExpirationTime from './expiration-time'
import HumanInputForm from './human-input-form'

const HumanInputContent = ({
  formData,
  showEmailTip = false,
  isEmailDebugMode = false,
  showDebugModeTip = false,
  showTimeout = false,
  executedAction,
  expirationTime,
  onSubmit,
}: HumanInputContentProps) => {
  const { t } = useTranslation()
  const email = useAppSelector(s => s.userProfile.email)

  return (
    <>
      <HumanInputForm
        formData={formData}
        onSubmit={onSubmit}
      />
      {/* Tips */}
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
                  i18nKey="common.humanInputEmailTipInDebugMode"
                  ns="workflow"
                  components={{ email: <span className="system-xs-semibold"></span> }}
                  values={{ email }}
                />
              </div>
            )}
            {showDebugModeTip && <div className="system-xs-medium text-text-warning">{t('common.humanInputWebappTip', { ns: 'workflow' })}</div>}
          </div>
        </>
      )}
      {/* Timeout */}
      {showTimeout && typeof expirationTime === 'number' && (
        <ExpirationTime expirationTime={expirationTime} />
      )}
      {/* Executed Action */}
      {executedAction && (
        <div className="flex flex-col gap-y-1 py-1">
          <Divider className="mb-2 mt-1 w-[30px]" />
          <div className="system-xs-regular flex items-center gap-x-1 text-text-tertiary">
            <TriggerAll className="size-3.5 shrink-0" />
            <Trans
              i18nKey="nodes.humanInput.userActions.triggered"
              ns="workflow"
              components={{ strong: <span className="system-xs-medium text-text-secondary"></span> }}
              values={{ actionName: executedAction.title }}
            />
          </div>
        </div>
      )}
    </>
  )
}

export default HumanInputContent
