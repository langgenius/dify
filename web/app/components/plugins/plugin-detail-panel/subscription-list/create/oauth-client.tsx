'use client'
import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerOAuthClientParams, TriggerOAuthConfig, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import type { ConfigureTriggerOAuthPayload } from '@/service/use-triggers'
import {
  RiClipboardLine,
  RiInformation2Fill,
} from '@remixicon/react'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { BaseForm } from '@/app/components/base/form/components/base'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { openOAuthPopup } from '@/hooks/use-oauth'
import {
  useConfigureTriggerOAuth,
  useDeleteTriggerOAuth,
  useInitiateTriggerOAuth,
  useVerifyAndUpdateTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import { usePluginStore } from '../../store'

type Props = {
  oauthConfig?: TriggerOAuthConfig
  onClose: () => void
  showOAuthCreateModal: (builder: TriggerSubscriptionBuilder) => void
}

enum AuthorizationStatusEnum {
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed',
}

enum ClientTypeEnum {
  Default = 'default',
  Custom = 'custom',
}

export const OAuthClientSettingsModal = ({ oauthConfig, onClose, showOAuthCreateModal }: Props) => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const { system_configured, params, oauth_client_schema } = oauthConfig || {}
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>()
  const [authorizationStatus, setAuthorizationStatus] = useState<AuthorizationStatusEnum>()

  const [clientType, setClientType] = useState<ClientTypeEnum>(system_configured ? ClientTypeEnum.Default : ClientTypeEnum.Custom)

  const clientFormRef = React.useRef<FormRefObject>(null)

  const oauthClientSchema = useMemo(() => {
    if (oauth_client_schema && oauth_client_schema.length > 0 && params) {
      const oauthConfigPramaKeys = Object.keys(params || {})
      for (const schema of oauth_client_schema) {
        if (oauthConfigPramaKeys.includes(schema.name))
          schema.default = params?.[schema.name]
      }
      return oauth_client_schema
    }
    return []
  }, [oauth_client_schema, params])

  const providerName = detail?.provider || ''
  const { mutate: initiateOAuth } = useInitiateTriggerOAuth()
  const { mutate: verifyBuilder } = useVerifyAndUpdateTriggerSubscriptionBuilder()
  const { mutate: configureOAuth } = useConfigureTriggerOAuth()
  const { mutate: deleteOAuth } = useDeleteTriggerOAuth()

  const confirmButtonText = useMemo(() => {
    if (authorizationStatus === AuthorizationStatusEnum.Pending)
      return t('modal.common.authorizing', { ns: 'pluginTrigger' })
    if (authorizationStatus === AuthorizationStatusEnum.Success)
      return t('modal.oauth.authorization.waitingJump', { ns: 'pluginTrigger' })
    return t('auth.saveAndAuth', { ns: 'plugin' })
  }, [authorizationStatus, t])

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message)
      return error.message
    if (typeof error === 'object' && error && 'message' in error) {
      const message = (error as { message?: string }).message
      if (typeof message === 'string' && message)
        return message
    }
    return fallback
  }

  const handleAuthorization = () => {
    setAuthorizationStatus(AuthorizationStatusEnum.Pending)
    initiateOAuth(providerName, {
      onSuccess: (response) => {
        setSubscriptionBuilder(response.subscription_builder)
        openOAuthPopup(response.authorization_url, (callbackData) => {
          if (callbackData) {
            Toast.notify({
              type: 'success',
              message: t('modal.oauth.authorization.authSuccess', { ns: 'pluginTrigger' }),
            })
            onClose()
            showOAuthCreateModal(response.subscription_builder)
          }
        })
      },
      onError: () => {
        setAuthorizationStatus(AuthorizationStatusEnum.Failed)
        Toast.notify({
          type: 'error',
          message: t('modal.oauth.authorization.authFailed', { ns: 'pluginTrigger' }),
        })
      },
    })
  }

  useEffect(() => {
    if (providerName && subscriptionBuilder && authorizationStatus === AuthorizationStatusEnum.Pending) {
      const pollInterval = setInterval(() => {
        verifyBuilder(
          {
            provider: providerName,
            subscriptionBuilderId: subscriptionBuilder.id,
          },
          {
            onSuccess: (response) => {
              if (response.verified) {
                setAuthorizationStatus(AuthorizationStatusEnum.Success)
                clearInterval(pollInterval)
              }
            },
            onError: () => {
              // Continue polling - auth might still be in progress
            },
          },
        )
      }, 3000)

      return () => clearInterval(pollInterval)
    }
  }, [subscriptionBuilder, authorizationStatus, verifyBuilder, providerName, t])

  const handleRemove = () => {
    deleteOAuth(providerName, {
      onSuccess: () => {
        onClose()
        Toast.notify({
          type: 'success',
          message: t('modal.oauth.remove.success', { ns: 'pluginTrigger' }),
        })
      },
      onError: (error: unknown) => {
        Toast.notify({
          type: 'error',
          message: getErrorMessage(error, t('modal.oauth.remove.failed', { ns: 'pluginTrigger' })),
        })
      },
    })
  }

  const handleSave = (needAuth: boolean) => {
    const isCustom = clientType === ClientTypeEnum.Custom
    const params: ConfigureTriggerOAuthPayload = {
      provider: providerName,
      enabled: isCustom,
    }

    if (isCustom) {
      const clientFormValues = clientFormRef.current?.getFormValues({}) as { values: TriggerOAuthClientParams, isCheckValidated: boolean }
      if (!clientFormValues.isCheckValidated)
        return
      const clientParams = clientFormValues.values
      if (clientParams.client_id === oauthConfig?.params.client_id)
        clientParams.client_id = '[__HIDDEN__]'

      if (clientParams.client_secret === oauthConfig?.params.client_secret)
        clientParams.client_secret = '[__HIDDEN__]'

      params.client_params = clientParams
    }

    configureOAuth(params, {
      onSuccess: () => {
        if (needAuth) {
          handleAuthorization()
        }
        else {
          onClose()
          Toast.notify({
            type: 'success',
            message: t('modal.oauth.save.success', { ns: 'pluginTrigger' }),
          })
        }
      },
    })
  }

  return (
    <Modal
      title={t('modal.oauth.title', { ns: 'pluginTrigger' })}
      confirmButtonText={confirmButtonText}
      cancelButtonText={t('auth.saveOnly', { ns: 'plugin' })}
      extraButtonText={t('operation.cancel', { ns: 'common' })}
      showExtraButton
      clickOutsideNotClose
      extraButtonVariant="secondary"
      onExtraButtonClick={onClose}
      onClose={onClose}
      onCancel={() => handleSave(false)}
      onConfirm={() => handleSave(true)}
      footerSlot={
        oauthConfig?.custom_enabled && oauthConfig?.params && clientType === ClientTypeEnum.Custom && (
          <div className="grow">
            <Button
              variant="secondary"
              className="text-components-button-destructive-secondary-text"
              // disabled={disabled || doingAction || !editValues}
              onClick={handleRemove}
            >
              {t('operation.remove', { ns: 'common' })}
            </Button>
          </div>
        )
      }
    >
      <div className="system-sm-medium mb-2 text-text-secondary">{t('subscription.addType.options.oauth.clientTitle', { ns: 'pluginTrigger' })}</div>
      {oauthConfig?.system_configured && (
        <div className="mb-4 flex w-full items-start justify-between gap-2">
          {[ClientTypeEnum.Default, ClientTypeEnum.Custom].map(option => (
            <OptionCard
              key={option}
              title={t(`subscription.addType.options.oauth.${option}`, { ns: 'pluginTrigger' })}
              onSelect={() => setClientType(option)}
              selected={clientType === option}
              className="flex-1"
            />
          ))}
        </div>
      )}
      {clientType === ClientTypeEnum.Custom && oauthConfig?.redirect_uri && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-background-section-burn p-4">
          <div className="rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg p-2 shadow-xs shadow-shadow-shadow-3">
            <RiInformation2Fill className="h-5 w-5 shrink-0 text-text-accent" />
          </div>
          <div className="flex-1 text-text-secondary">
            <div className="system-sm-regular whitespace-pre-wrap leading-4">
              {t('modal.oauthRedirectInfo', { ns: 'pluginTrigger' })}
            </div>
            <div className="system-sm-medium my-1.5 break-all leading-4">
              {oauthConfig.redirect_uri}
            </div>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(oauthConfig.redirect_uri)
                Toast.notify({
                  type: 'success',
                  message: t('actionMsg.copySuccessfully', { ns: 'common' }),
                })
              }}
            >
              <RiClipboardLine className="mr-1 h-[14px] w-[14px]" />
              {t('operation.copy', { ns: 'common' })}
            </Button>
          </div>
        </div>
      )}
      {clientType === ClientTypeEnum.Custom && oauthClientSchema.length > 0 && (
        <BaseForm
          formSchemas={oauthClientSchema}
          ref={clientFormRef}
          labelClassName="system-sm-medium mb-2 block text-text-secondary"
          formClassName="space-y-4"
        />
      )}
    </Modal>
  )
}
