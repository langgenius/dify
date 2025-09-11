'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiClipboardLine,
  RiCloseLine,
  RiInformation2Fill,
} from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import Form from '@/app/components/base/form/form-scenarios/auth'
import type { FormRefObject } from '@/app/components/base/form/types'
import {
  useBuildTriggerSubscription,
  useInitiateTriggerOAuth,
  useTriggerOAuthConfig,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import type { PluginDetail } from '@/app/components/plugins/types'
import ActionButton from '@/app/components/base/action-button'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'

type Props = {
  pluginDetail: PluginDetail
  onClose: () => void
  onSuccess: () => void
}

enum OAuthStepEnum {
  Setup = 'setup',
  Configuration = 'configuration',
}

enum AuthorizationStatusEnum {
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed',
}

const OAuthAddModal = ({ pluginDetail, onClose, onSuccess }: Props) => {
  const { t } = useTranslation()

  const [currentStep, setCurrentStep] = useState<OAuthStepEnum>(OAuthStepEnum.Setup)
  const [subscriptionName, setSubscriptionName] = useState('')
  const [authorizationUrl, setAuthorizationUrl] = useState('')
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>()
  const [authorizationStatus, setAuthorizationStatus] = useState<AuthorizationStatusEnum>()

  const clientFormRef = React.useRef<FormRefObject>(null)
  const parametersFormRef = React.useRef<FormRefObject>(null)

  const providerName = `${pluginDetail.plugin_id}/${pluginDetail.declaration.name}`
  const clientSchema = pluginDetail.declaration.trigger?.oauth_schema?.client_schema || []
  const parametersSchema = pluginDetail.declaration.trigger?.subscription_schema?.parameters_schema || []

  const { mutate: initiateOAuth } = useInitiateTriggerOAuth()
  const { mutate: verifyBuilder } = useVerifyTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()

  const { data: oauthConfig } = useTriggerOAuthConfig(providerName)

  useEffect(() => {
    initiateOAuth(providerName, {
      onSuccess: (response) => {
        setAuthorizationUrl(response.authorization_url)
        setSubscriptionBuilder(response.subscription_builder)
      },
      onError: (error: any) => {
        Toast.notify({
          type: 'error',
          message: error?.message || t('pluginTrigger.modal.errors.authFailed'),
        })
      },
    })
  }, [initiateOAuth, providerName, t])

  useEffect(() => {
    if (currentStep === OAuthStepEnum.Setup && subscriptionBuilder && authorizationStatus === AuthorizationStatusEnum.Pending) {
      const pollInterval = setInterval(() => {
        verifyBuilder(
          {
            provider: providerName,
            subscriptionBuilderId: subscriptionBuilder.id,
          },
          {
            onSuccess: () => {
              setAuthorizationStatus(AuthorizationStatusEnum.Success)
              setCurrentStep(OAuthStepEnum.Configuration)
              Toast.notify({
                type: 'success',
                message: t('pluginTrigger.modal.oauth.authorization.authSuccess'),
              })
              clearInterval(pollInterval)
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

  const handleAuthorize = () => {
    const clientFormValues = clientFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    const clientParams = clientFormValues.values

    if (!Object.keys(clientParams).length) {
      Toast.notify({
        type: 'error',
        message: t('pluginTrigger.modal.oauth.authorization.authFailed'),
      })
      return
    }
    setAuthorizationStatus(AuthorizationStatusEnum.Pending)
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

    const parameters = parametersFormRef.current?.getFormValues({})?.values

    buildSubscription(
      {
        provider: providerName,
        subscriptionBuilderId: subscriptionBuilder.id,
        params: {
          name: subscriptionName,
          parameters,
        } as Record<string, any>,
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
      className='!max-w-[520px] p-6'
      wrapperClassName='!z-[1002]'
    >
      <div className='flex items-center justify-between pb-3'>
        <h3 className='text-lg font-semibold text-text-primary'>
          {t('pluginTrigger.modal.oauth.title')}
        </h3>
        <ActionButton onClick={onClose}>
          <RiCloseLine className='h-4 w-4' />
        </ActionButton>
      </div>

      <div className='py-3'>
        {currentStep === OAuthStepEnum.Setup && (
          <>
            {oauthConfig?.redirect_uri && (
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

            {clientSchema.length > 0 && (
              <Form
                formSchemas={clientSchema}
                ref={clientFormRef}
              />
            )}
          </>
        )}

        {currentStep === OAuthStepEnum.Configuration && (
          <div>
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

            {parametersSchema.length > 0 && (
              <Form
                formSchemas={parametersSchema}
                ref={parametersFormRef}
              />
            )}
          </div>
        )}
      </div>

      <div className='flex justify-end gap-2 pt-5'>
        <Button variant='secondary' onClick={onClose}>
          {t('pluginTrigger.modal.common.cancel')}
        </Button>

        {currentStep === OAuthStepEnum.Setup && (
          <Button
            variant='primary'
            onClick={handleAuthorize}
            loading={authorizationStatus === AuthorizationStatusEnum.Pending}
          >
            {authorizationStatus === AuthorizationStatusEnum.Pending ? t('pluginTrigger.modal.common.authorizing') : t('pluginTrigger.modal.common.authorize')}
          </Button>
        )}

        {currentStep === OAuthStepEnum.Configuration && (
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
