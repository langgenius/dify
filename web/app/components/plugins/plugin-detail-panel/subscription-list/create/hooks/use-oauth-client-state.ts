'use client'
import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerOAuthClientParams, TriggerOAuthConfig, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import type { ConfigureTriggerOAuthPayload } from '@/service/use-triggers'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { openOAuthPopup } from '@/hooks/use-oauth'
import {
  useConfigureTriggerOAuth,
  useDeleteTriggerOAuth,
  useInitiateTriggerOAuth,
  useVerifyAndUpdateTriggerSubscriptionBuilder,
} from '@/service/use-triggers'

export enum AuthorizationStatusEnum {
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed',
}

export enum ClientTypeEnum {
  Default = 'default',
  Custom = 'custom',
}

const POLL_INTERVAL_MS = 3000

// Extract error message from various error formats
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message)
    return error.message
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: string }).message
    if (typeof message === 'string' && message)
      return message
  }
  return fallback
}

type UseOAuthClientStateParams = {
  oauthConfig?: TriggerOAuthConfig
  providerName: string
  onClose: () => void
  showOAuthCreateModal: (builder: TriggerSubscriptionBuilder) => void
}

type UseOAuthClientStateReturn = {
  // State
  clientType: ClientTypeEnum
  setClientType: (type: ClientTypeEnum) => void
  authorizationStatus: AuthorizationStatusEnum | undefined

  // Refs
  clientFormRef: React.RefObject<FormRefObject | null>

  // Computed values
  oauthClientSchema: TriggerOAuthConfig['oauth_client_schema']
  confirmButtonText: string

  // Handlers
  handleAuthorization: () => void
  handleRemove: () => void
  handleSave: (needAuth: boolean) => void
}

export const useOAuthClientState = ({
  oauthConfig,
  providerName,
  onClose,
  showOAuthCreateModal,
}: UseOAuthClientStateParams): UseOAuthClientStateReturn => {
  const { t } = useTranslation()

  // State management
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>()
  const [authorizationStatus, setAuthorizationStatus] = useState<AuthorizationStatusEnum>()
  const [clientType, setClientType] = useState<ClientTypeEnum>(
    oauthConfig?.system_configured ? ClientTypeEnum.Default : ClientTypeEnum.Custom,
  )

  const clientFormRef = useRef<FormRefObject>(null)

  // Mutations
  const { mutate: initiateOAuth } = useInitiateTriggerOAuth()
  const { mutate: verifyBuilder } = useVerifyAndUpdateTriggerSubscriptionBuilder()
  const { mutate: configureOAuth } = useConfigureTriggerOAuth()
  const { mutate: deleteOAuth } = useDeleteTriggerOAuth()

  // Compute OAuth client schema with default values
  const oauthClientSchema = useMemo(() => {
    const { oauth_client_schema, params } = oauthConfig || {}
    if (!oauth_client_schema?.length || !params)
      return []

    const paramKeys = Object.keys(params)
    return oauth_client_schema.map(schema => ({
      ...schema,
      default: paramKeys.includes(schema.name) ? params[schema.name] : schema.default,
    }))
  }, [oauthConfig])

  // Compute confirm button text based on authorization status
  const confirmButtonText = useMemo(() => {
    if (authorizationStatus === AuthorizationStatusEnum.Pending)
      return t('modal.common.authorizing', { ns: 'pluginTrigger' })
    if (authorizationStatus === AuthorizationStatusEnum.Success)
      return t('modal.oauth.authorization.waitingJump', { ns: 'pluginTrigger' })
    return t('auth.saveAndAuth', { ns: 'plugin' })
  }, [authorizationStatus, t])

  // Authorization handler
  const handleAuthorization = useCallback(() => {
    setAuthorizationStatus(AuthorizationStatusEnum.Pending)
    initiateOAuth(providerName, {
      onSuccess: (response) => {
        setSubscriptionBuilder(response.subscription_builder)
        openOAuthPopup(response.authorization_url, (callbackData) => {
          if (!callbackData)
            return
          Toast.notify({
            type: 'success',
            message: t('modal.oauth.authorization.authSuccess', { ns: 'pluginTrigger' }),
          })
          onClose()
          showOAuthCreateModal(response.subscription_builder)
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
  }, [providerName, initiateOAuth, onClose, showOAuthCreateModal, t])

  // Remove handler
  const handleRemove = useCallback(() => {
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
  }, [providerName, deleteOAuth, onClose, t])

  // Save handler
  const handleSave = useCallback((needAuth: boolean) => {
    const isCustom = clientType === ClientTypeEnum.Custom
    const params: ConfigureTriggerOAuthPayload = {
      provider: providerName,
      enabled: isCustom,
    }

    if (isCustom && oauthClientSchema?.length) {
      const clientFormValues = clientFormRef.current?.getFormValues({}) as {
        values: TriggerOAuthClientParams
        isCheckValidated: boolean
      } | undefined
      // Handle missing ref or form values
      if (!clientFormValues || !clientFormValues.isCheckValidated)
        return
      const clientParams = { ...clientFormValues.values }
      // Preserve hidden values if unchanged
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
          return
        }
        onClose()
        Toast.notify({
          type: 'success',
          message: t('modal.oauth.save.success', { ns: 'pluginTrigger' }),
        })
      },
    })
  }, [clientType, providerName, oauthClientSchema, oauthConfig?.params, configureOAuth, handleAuthorization, onClose, t])

  // Polling effect for authorization verification
  useEffect(() => {
    const shouldPoll = providerName
      && subscriptionBuilder
      && authorizationStatus === AuthorizationStatusEnum.Pending

    if (!shouldPoll)
      return

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
            // Continue polling on error - auth might still be in progress
          },
        },
      )
    }, POLL_INTERVAL_MS)

    return () => clearInterval(pollInterval)
  }, [subscriptionBuilder, authorizationStatus, verifyBuilder, providerName])

  return {
    clientType,
    setClientType,
    authorizationStatus,
    clientFormRef,
    oauthClientSchema,
    confirmButtonText,
    handleAuthorization,
    handleRemove,
    handleSave,
  }
}
