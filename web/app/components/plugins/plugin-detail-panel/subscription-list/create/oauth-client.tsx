'use client'
import Button from '@/app/components/base/button'
import { BaseForm } from '@/app/components/base/form/components/base'
import type { FormRefObject } from '@/app/components/base/form/types'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import type { TriggerOAuthClientParams, TriggerOAuthConfig, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { openOAuthPopup } from '@/hooks/use-oauth'
import type { ConfigureTriggerOAuthPayload } from '@/service/use-triggers'
import {
  useConfigureTriggerOAuth,
  useDeleteTriggerOAuth,
  useInitiateTriggerOAuth,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import {
  RiClipboardLine,
  RiInformation2Fill,
} from '@remixicon/react'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { mutate: verifyBuilder } = useVerifyTriggerSubscriptionBuilder()
  const { mutate: configureOAuth } = useConfigureTriggerOAuth()
  const { mutate: deleteOAuth } = useDeleteTriggerOAuth()

  const handleAuthorization = () => {
    setAuthorizationStatus(AuthorizationStatusEnum.Pending)
    initiateOAuth(providerName, {
      onSuccess: (response) => {
        setSubscriptionBuilder(response.subscription_builder)
        openOAuthPopup(response.authorization_url, (callbackData) => {
          if (callbackData) {
            Toast.notify({
              type: 'success',
              message: t('pluginTrigger.modal.oauth.authorization.authSuccess'),
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
          message: t('pluginTrigger.modal.oauth.authorization.authFailed'),
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
          message: t('pluginTrigger.modal.oauth.remove.success'),
        })
      },
      onError: (error: any) => {
        Toast.notify({
          type: 'error',
          message: error?.message || t('pluginTrigger.modal.oauth.remove.failed'),
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
            message: t('pluginTrigger.modal.oauth.save.success'),
          })
        }
      },
    })
  }

  return (
    <Modal
      title={t('pluginTrigger.modal.oauth.title')}
      confirmButtonText={authorizationStatus === AuthorizationStatusEnum.Pending ? t('pluginTrigger.modal.common.authorizing')
        : authorizationStatus === AuthorizationStatusEnum.Success ? t('pluginTrigger.modal.oauth.authorization.waitingJump') : t('plugin.auth.saveAndAuth')}
      cancelButtonText={t('plugin.auth.saveOnly')}
      extraButtonText={t('common.operation.cancel')}
      showExtraButton
      clickOutsideNotClose
      extraButtonVariant='secondary'
      onExtraButtonClick={onClose}
      onClose={onClose}
      onCancel={() => handleSave(false)}
      onConfirm={() => handleSave(true)}
      footerSlot={
        oauthConfig?.custom_enabled && oauthConfig?.params && clientType === ClientTypeEnum.Custom && (
          <div className='grow'>
            <Button
              variant='secondary'
              className='text-components-button-destructive-secondary-text'
              // disabled={disabled || doingAction || !editValues}
              onClick={handleRemove}
            >
              {t('common.operation.remove')}
            </Button>
          </div>
        )
      }
    >
      <div className='system-sm-medium mb-2 text-text-secondary'>{t('pluginTrigger.subscription.addType.options.oauth.clientTitle')}</div>
      {oauthConfig?.system_configured && <div className='mb-4 flex w-full items-start justify-between gap-2'>
        {[ClientTypeEnum.Default, ClientTypeEnum.Custom].map(option => (
          <OptionCard
            key={option}
            title={t(`pluginTrigger.subscription.addType.options.oauth.${option}`)}
            onSelect={() => setClientType(option)}
            selected={clientType === option}
            className="flex-1"
          />
        ))}
      </div>}
      {clientType === ClientTypeEnum.Custom && oauthConfig?.redirect_uri && (
        <div className='mb-4 flex items-start gap-3 rounded-xl bg-background-section-burn p-4'>
          <div className='rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg p-2 shadow-xs shadow-shadow-shadow-3'>
            <RiInformation2Fill className='h-5 w-5 shrink-0 text-text-accent' />
          </div>
          <div className='flex-1 text-text-secondary'>
            <div className='system-sm-regular whitespace-pre-wrap leading-4'>
              {t('pluginTrigger.modal.oauthRedirectInfo')}
            </div>
            <div className='system-sm-medium my-1.5 break-all leading-4'>
              {oauthConfig.redirect_uri}
            </div>
            <Button
              variant='secondary'
              size='small'
              onClick={() => {
                navigator.clipboard.writeText(oauthConfig.redirect_uri)
                Toast.notify({
                  type: 'success',
                  message: t('common.actionMsg.copySuccessfully'),
                })
              }}>
              <RiClipboardLine className='mr-1 h-[14px] w-[14px]' />
              {t('common.operation.copy')}
            </Button>
          </div>
        </div>
      )}
      {clientType === ClientTypeEnum.Custom && oauthClientSchema.length > 0 && (
        <BaseForm
          formSchemas={oauthClientSchema}
          ref={clientFormRef}
          labelClassName='system-sm-medium mb-2 block text-text-secondary'
          formClassName='space-y-4'
        />
      )}
    </Modal >
  )
}
