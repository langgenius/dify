'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiExternalLinkLine,
} from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import Form from '@/app/components/base/form/form-scenarios/auth'
import type { FormRefObject } from '@/app/components/base/form/types'
import {
  useBuildTriggerSubscription,
  useConfigureTriggerOAuth,
  useInitiateTriggerOAuth,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import type { PluginDetail } from '@/app/components/plugins/types'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'

type Props = {
  pluginDetail: PluginDetail
  onClose: () => void
  onSuccess: () => void
}

type OAuthStep = 'setup' | 'authorize' | 'configuration'

const OAuthAddModal = ({ pluginDetail, onClose, onSuccess }: Props) => {
  const { t } = useTranslation()

  // State
  const [currentStep, setCurrentStep] = useState<OAuthStep>('setup')
  const [subscriptionName, setSubscriptionName] = useState('')
  const [authorizationUrl, setAuthorizationUrl] = useState('')
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<any>(null)
  const [redirectUrl, setRedirectUrl] = useState('')
  const [authorizationStatus, setAuthorizationStatus] = useState<'pending' | 'success' | 'failed'>('pending')

  // Form refs
  const clientFormRef = React.useRef<FormRefObject>(null)
  const parametersFormRef = React.useRef<FormRefObject>(null)

  // API mutations
  const { mutate: initiateOAuth, isPending: isInitiating } = useInitiateTriggerOAuth()
  const { mutate: configureOAuth, isPending: isConfiguring } = useConfigureTriggerOAuth()
  const { mutate: verifyBuilder } = useVerifyTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()

  // Get provider name and schemas
  const providerName = `${pluginDetail.plugin_id}/${pluginDetail.declaration.name}`
  const clientSchema = pluginDetail.declaration.trigger?.oauth_schema?.client_schema || []
  const parametersSchema = pluginDetail.declaration.trigger?.subscription_schema?.parameters_schema || []

  // Poll for authorization status
  useEffect(() => {
    if (currentStep === 'authorize' && subscriptionBuilder && authorizationStatus === 'pending') {
      const pollInterval = setInterval(() => {
        verifyBuilder(
          {
            provider: providerName,
            subscriptionBuilderId: subscriptionBuilder.id,
          },
          {
            onSuccess: () => {
              setAuthorizationStatus('success')
              setCurrentStep('configuration')
              Toast.notify({
                type: 'success',
                message: t('pluginTrigger.modal.oauth.authorization.authSuccess'),
              })
            },
            onError: () => {
              // Continue polling - auth might still be in progress
            },
          },
        )
      }, 3000)

      return () => clearInterval(pollInterval)
    }
  }, [currentStep, subscriptionBuilder, authorizationStatus, verifyBuilder, providerName, t])

  const handleSetupOAuth = () => {
    const clientFormValues = clientFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    const clientParams = clientFormValues.values

    if (!Object.keys(clientParams).length) {
      Toast.notify({
        type: 'error',
        message: t('pluginTrigger.modal.oauth.authorization.authFailed'),
      })
      return
    }

    // First configure OAuth client
    configureOAuth(
      {
        provider: providerName,
        client_params: clientParams as any,
        enabled: true,
      },
      {
        onSuccess: () => {
          // Then get redirect URL and initiate OAuth
          const baseUrl = window.location.origin
          const redirectPath = `/plugins/oauth/callback/${providerName}`
          const fullRedirectUrl = `${baseUrl}${redirectPath}`
          setRedirectUrl(fullRedirectUrl)

          // Initiate OAuth flow
          initiateOAuth(providerName, {
            onSuccess: (response) => {
              setAuthorizationUrl(response.authorization_url)
              setSubscriptionBuilder(response.subscription_builder)
              setCurrentStep('authorize')
            },
            onError: (error: any) => {
              Toast.notify({
                type: 'error',
                message: error?.message || t('pluginTrigger.modal.errors.authFailed'),
              })
            },
          })
        },
        onError: (error: any) => {
          Toast.notify({
            type: 'error',
            message: error?.message || t('pluginTrigger.modal.errors.authFailed'),
          })
        },
      },
    )
  }

  const handleAuthorize = () => {
    if (authorizationUrl) {
      // Open authorization URL in new window
      window.open(authorizationUrl, '_blank', 'width=500,height=600')
    }
  }

  const handleCreate = () => {
    if (!subscriptionName.trim()) {
      Toast.notify({
        type: 'error',
        message: t('pluginTrigger.modal.form.subscriptionName.required'),
      })
      return
    }

    if (!subscriptionBuilder)
      return

    buildSubscription(
      {
        provider: providerName,
        subscriptionBuilderId: subscriptionBuilder.id,
      },
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: t('pluginTrigger.modal.oauth.configuration.success'),
          })
          onSuccess()
          onClose()
        },
        onError: (error: any) => {
          Toast.notify({
            type: 'error',
            message: error?.message || t('pluginTrigger.modal.errors.createFailed'),
          })
        },
      },
    )
  }

  return (
    <Modal
      isShow
      onClose={onClose}
      className='!max-w-[520px] !p-0'
      wrapperClassName='!z-[1002]'
    >
      <div className='flex items-center justify-between border-b border-divider-subtle p-6 pb-4'>
        <h3 className='text-lg font-semibold text-text-primary'>
          {t('pluginTrigger.modal.oauth.title')}
        </h3>
        <Button variant='ghost' size='small' onClick={onClose}>
          <RiCloseLine className='h-4 w-4' />
        </Button>
      </div>

      <div className='p-6'>
        {currentStep === 'setup' && (
          <div>
            <div className='mb-4'>
              <h4 className='system-sm-semibold mb-2 text-text-primary'>
                {t('pluginTrigger.modal.oauth.authorization.title')}
              </h4>
              <p className='system-xs-regular text-text-secondary'>
                {t('pluginTrigger.modal.oauth.authorization.description')}
              </p>
            </div>

            {clientSchema.length > 0 && (
              <div className='mb-4'>
                <Form
                  formSchemas={clientSchema}
                  ref={clientFormRef}
                />
              </div>
            )}
          </div>
        )}

        {currentStep === 'authorize' && (
          <div>
            <div className='mb-4'>
              <h4 className='system-sm-semibold mb-2 text-text-primary'>
                {t('pluginTrigger.modal.oauth.authorization.title')}
              </h4>
              <p className='system-xs-regular mb-4 text-text-secondary'>
                {t('pluginTrigger.modal.oauth.authorization.description')}
              </p>
            </div>

            {/* Redirect URL */}
            {redirectUrl && (
              <div className='mb-4'>
                <label className='system-sm-medium mb-2 block text-text-primary'>
                  {t('pluginTrigger.modal.oauth.authorization.redirectUrl')}
                </label>
                <div className='relative'>
                  <Input
                    value={redirectUrl}
                    readOnly
                    className='bg-background-section pr-12'
                  />
                  <CopyFeedbackNew
                    content={redirectUrl}
                    className='absolute right-1 top-1/2 -translate-y-1/2 text-text-tertiary'
                  />
                </div>
                <div className='system-xs-regular mt-1 text-text-tertiary'>
                  {t('pluginTrigger.modal.oauth.authorization.redirectUrlHelp')}
                </div>
              </div>
            )}

            {/* Authorization Status */}
            <div className='mb-4 rounded-lg bg-background-section p-4'>
              {authorizationStatus === 'pending' && (
                <div className='system-sm-regular text-text-secondary'>
                  {t('pluginTrigger.modal.oauth.authorization.waitingAuth')}
                </div>
              )}
              {authorizationStatus === 'success' && (
                <div className='system-sm-regular text-text-success'>
                  {t('pluginTrigger.modal.oauth.authorization.authSuccess')}
                </div>
              )}
              {authorizationStatus === 'failed' && (
                <div className='system-sm-regular text-text-destructive'>
                  {t('pluginTrigger.modal.oauth.authorization.authFailed')}
                </div>
              )}
            </div>

            {/* Authorize Button */}
            {authorizationStatus === 'pending' && (
              <Button
                variant='primary'
                onClick={handleAuthorize}
                disabled={!authorizationUrl}
                className='w-full'
              >
                <RiExternalLinkLine className='mr-2 h-4 w-4' />
                {t('pluginTrigger.modal.oauth.authorization.authorizeButton', { provider: providerName })}
              </Button>
            )}
          </div>
        )}

        {currentStep === 'configuration' && (
          <div>
            <div className='mb-4'>
              <h4 className='system-sm-semibold mb-2 text-text-primary'>
                {t('pluginTrigger.modal.oauth.configuration.title')}
              </h4>
              <p className='system-xs-regular text-text-secondary'>
                {t('pluginTrigger.modal.oauth.configuration.description')}
              </p>
            </div>

            {/* Subscription Name */}
            <div className='mb-4'>
              <label className='system-sm-medium mb-2 block text-text-primary'>
                {t('pluginTrigger.modal.form.subscriptionName.label')}
              </label>
              <Input
                value={subscriptionName}
                onChange={e => setSubscriptionName(e.target.value)}
                placeholder={t('pluginTrigger.modal.form.subscriptionName.placeholder')}
              />
            </div>

            {/* Callback URL (read-only) */}
            {subscriptionBuilder?.endpoint && (
              <div className='mb-4'>
                <label className='system-sm-medium mb-2 block text-text-primary'>
                  {t('pluginTrigger.modal.form.callbackUrl.label')}
                </label>
                <Input
                  value={subscriptionBuilder.endpoint}
                  readOnly
                  className='bg-background-section'
                />
                <div className='system-xs-regular mt-1 text-text-tertiary'>
                  {t('pluginTrigger.modal.form.callbackUrl.description')}
                </div>
              </div>
            )}

            {/* Dynamic Parameters Form */}
            {parametersSchema.length > 0 && (
              <div className='mb-4'>
                <Form
                  formSchemas={parametersSchema}
                  ref={parametersFormRef}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className='flex justify-end gap-2 border-t border-divider-subtle p-6 pt-4'>
        <Button variant='secondary' onClick={onClose}>
          {t('pluginTrigger.modal.common.cancel')}
        </Button>

        {currentStep === 'setup' && (
          <Button
            variant='primary'
            onClick={handleSetupOAuth}
            loading={isConfiguring || isInitiating}
            // disabled={clientSchema.length > 0}
          >
            {(isConfiguring || isInitiating) ? t('pluginTrigger.modal.common.authorizing') : t('pluginTrigger.modal.common.authorize')}
          </Button>
        )}

        {currentStep === 'configuration' && (
          <Button
            variant='primary'
            onClick={handleCreate}
            loading={isBuilding}
            disabled={!subscriptionName.trim()}
          >
            {isBuilding ? t('pluginTrigger.modal.common.creating') : t('pluginTrigger.modal.common.create')}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export default OAuthAddModal
