import type { PluginPayload } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import Authorize from './authorize'
import Authorized from './authorized'
import { usePluginAuth } from './hooks/use-plugin-auth'
import { AuthCategory } from './types'

type PluginAuthProps = {
  pluginPayload: PluginPayload
  children?: React.ReactNode
  className?: string
}
const PluginAuth = ({
  pluginPayload,
  children,
  className,
}: PluginAuthProps) => {
  const { t } = useTranslation()
  const { setShowAccountSettingModal } = useModalContext()
  const {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials,
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
  } = usePluginAuth(pluginPayload, !!pluginPayload.provider)
  const showPermissionHint = !isAuthorized
    && !notAllowCustomCredential
    && pluginPayload.category === AuthCategory.tool
    && (canOAuth || canApiKey)
  const authorizeContent = (
    <Authorize
      pluginPayload={pluginPayload}
      canOAuth={canOAuth}
      canApiKey={canApiKey}
      onUpdate={invalidPluginCredentialInfo}
      notAllowCustomCredential={notAllowCustomCredential}
    />
  )

  return (
    <div className={cn(!isAuthorized && className)}>
      {
        !isAuthorized && (
          <>
            {authorizeContent}
            {
              showPermissionHint && (
                <div className="mt-2 rounded-lg border border-divider-subtle bg-background-section-burn px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="mt-0.5 i-ri-lock-2-line size-3.5 shrink-0 text-text-tertiary" />
                    <div className="min-w-0 grow">
                      <div className="system-xs-medium text-text-secondary">
                        {t($ => $['auth.permissionHint.title'], { ns: 'plugin' })}
                      </div>
                      <div className="mt-0.5 system-xs-regular text-text-tertiary">
                        {t($ => $['auth.permissionHint.description'], { ns: 'plugin' })}
                      </div>
                      <div className="mt-1.5">
                        <button
                          type="button"
                          className="-ml-1.5 rounded-md px-1.5 py-0.5 system-xs-medium text-text-accent hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                          onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MEMBERS })}
                        >
                          {t($ => $['auth.permissionHint.action'], { ns: 'plugin' })}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
          </>
        )
      }
      {
        isAuthorized && !children && (
          <Authorized
            pluginPayload={pluginPayload}
            credentials={credentials}
            canOAuth={canOAuth}
            canApiKey={canApiKey}
            onUpdate={invalidPluginCredentialInfo}
            notAllowCustomCredential={notAllowCustomCredential}
          />
        )
      }
      {
        isAuthorized && children
      }
    </div>
  )
}

export default memo(PluginAuth)
