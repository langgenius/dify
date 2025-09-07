'use client'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiEqualizer2Line } from '@remixicon/react'
import Button from '@/app/components/base/button'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import {
  useInitiateTriggerOAuth,
  useInvalidateTriggerSubscriptions,
  useTriggerOAuthConfig,
} from '@/service/use-triggers'
import { useToastContext } from '@/app/components/base/toast'
import { openOAuthPopup } from '@/hooks/use-oauth'
import ApiKeyConfigModal from './api-key-config-modal'
import OAuthClientConfigModal from './oauth-client-config-modal'

type AuthMethodSelectorProps = {
  provider: TriggerWithProvider
  supportedMethods: string[]
}

const AuthMethodSelector: FC<AuthMethodSelectorProps> = ({
  provider,
  supportedMethods,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [showOAuthClientModal, setShowOAuthClientModal] = useState(false)
  const initiateTriggerOAuth = useInitiateTriggerOAuth()
  const invalidateSubscriptions = useInvalidateTriggerSubscriptions()

  const providerPath = `${provider.plugin_id}/${provider.name}`
  const { data: oauthConfig } = useTriggerOAuthConfig(providerPath, supportedMethods.includes('oauth'))

  const handleOAuthAuth = useCallback(async () => {
    // Check if OAuth client is configured
    if (!oauthConfig?.custom_configured || !oauthConfig?.custom_enabled) {
      // Need to configure OAuth client first
      setShowOAuthClientModal(true)
      return
    }

    try {
      const response = await initiateTriggerOAuth.mutateAsync(providerPath)
      if (response.authorization_url) {
        openOAuthPopup(response.authorization_url, (callbackData) => {
          invalidateSubscriptions(providerPath)

          if (callbackData?.success === false) {
            notify({
              type: 'error',
              message: callbackData.errorDescription || callbackData.error || t('workflow.nodes.triggerPlugin.authenticationFailed'),
            })
          }
          else if (callbackData?.subscriptionId) {
            notify({
              type: 'success',
              message: t('workflow.nodes.triggerPlugin.authenticationSuccess'),
            })
          }
        })
      }
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.oauthConfigFailed', { error: error.message }),
      })
    }
  }, [providerPath, initiateTriggerOAuth, invalidateSubscriptions, notify, oauthConfig])

  const handleApiKeyAuth = useCallback(() => {
    setShowApiKeyModal(true)
  }, [])

  if (!supportedMethods.includes('oauth') && !supportedMethods.includes('api_key'))
    return null

  return (
    <div className="px-4 pb-2">
      <div className="flex w-full items-center">
        {/* OAuth Button Group */}
        {supportedMethods.includes('oauth') && (
          <div className="flex flex-1">
            <Button
              variant="primary"
              size="medium"
              onClick={handleOAuthAuth}
              className="flex-1 rounded-r-none"
            >
              {t('workflow.nodes.triggerPlugin.useOAuth')}
            </Button>
            <div className="h-4 w-px bg-text-primary-on-surface opacity-15" />
            <Button
              variant="primary"
              size="medium"
              className="min-w-0 rounded-l-none px-2"
              onClick={() => setShowOAuthClientModal(true)}
            >
              <RiEqualizer2Line className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Divider with OR */}
        {supportedMethods.includes('oauth') && supportedMethods.includes('api_key') && (
          <div className="flex h-8 flex-col items-center justify-center px-1">
            <div className="h-2 w-px bg-divider-subtle" />
            <span className="px-1 text-xs font-medium text-text-tertiary">{t('workflow.nodes.triggerPlugin.or')}</span>
            <div className="h-2 w-px bg-divider-subtle" />
          </div>
        )}

        {/* API Key Button */}
        {supportedMethods.includes('api_key') && (
          <div className="flex flex-1">
            <Button
              variant="secondary-accent"
              size="medium"
              onClick={handleApiKeyAuth}
              className="flex-1"
            >
              {t('workflow.nodes.triggerPlugin.useApiKey')}
            </Button>
          </div>
        )}
      </div>

      {/* API Key Configuration Modal */}
      {showApiKeyModal && (
        <ApiKeyConfigModal
          provider={provider}
          onCancel={() => setShowApiKeyModal(false)}
          onSuccess={() => {
            setShowApiKeyModal(false)
            invalidateSubscriptions(providerPath)
          }}
        />
      )}

      {/* OAuth Client Configuration Modal */}
      {showOAuthClientModal && (
        <OAuthClientConfigModal
          provider={provider}
          onCancel={() => setShowOAuthClientModal(false)}
          onSuccess={() => {
            setShowOAuthClientModal(false)
            // After OAuth client configuration, proceed with OAuth auth
            handleOAuthAuth()
          }}
        />
      )}
    </div>
  )
}

export default AuthMethodSelector
