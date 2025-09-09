'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCloseLine,
} from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import Form from '@/app/components/base/form/form-scenarios/auth'
import type { FormRefObject } from '@/app/components/base/form/types'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import type { PluginDetail } from '@/app/components/plugins/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'

type Props = {
  pluginDetail: PluginDetail
  onClose: () => void
  onSuccess: () => void
}

enum ApiKeyStep {
  Verify = 'verify',
  Configuration = 'configuration',
}

const ApiKeyAddModal = ({ pluginDetail, onClose, onSuccess }: Props) => {
  const { t } = useTranslation()

  // State
  const [currentStep, setCurrentStep] = useState<ApiKeyStep>(ApiKeyStep.Verify)
  const [subscriptionName, setSubscriptionName] = useState('')
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<any>(null)
  const [verificationError, setVerificationError] = useState<string>('')

  // Form refs
  const credentialsFormRef = React.useRef<FormRefObject>(null)
  const parametersFormRef = React.useRef<FormRefObject>(null)

  // API mutations
  const { mutate: createBuilder, isPending: isCreatingBuilder } = useCreateTriggerSubscriptionBuilder()
  const { mutate: verifyBuilder, isPending: isVerifying } = useVerifyTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()

  // Get provider name and schemas
  const providerName = `${pluginDetail.plugin_id}/${pluginDetail.declaration.name}`
  const credentialsSchema = pluginDetail.declaration.trigger?.credentials_schema || []
  const parametersSchema = pluginDetail.declaration.trigger?.subscription_schema?.parameters_schema || []

  const handleVerify = () => {
    const credentialsFormValues = credentialsFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    const credentials = credentialsFormValues.values

    if (!Object.keys(credentials).length) {
      Toast.notify({
        type: 'error',
        message: 'Please fill in all required credentials',
      })
      return
    }

    setVerificationError('')

    // First create builder
    createBuilder(
      {
        provider: providerName,
        credential_type: TriggerCredentialTypeEnum.ApiKey,
      },
      {
        onSuccess: (response) => {
          const builder = response.subscription_builder
          setSubscriptionBuilder(builder)

          // setCurrentStep('configuration')

          verifyBuilder(
            {
              provider: providerName,
              subscriptionBuilderId: builder.id,
              credentials,
            },
            {
              onSuccess: () => {
                Toast.notify({
                  type: 'success',
                  message: t('pluginTrigger.modal.apiKey.verify.success'),
                })
                setCurrentStep(ApiKeyStep.Configuration)
              },
              onError: (error: any) => {
                setVerificationError(error?.message || t('pluginTrigger.modal.apiKey.verify.error'))
              },
            },
          )
        },
        onError: (error: any) => {
          Toast.notify({
            type: 'error',
            message: error?.message || t('pluginTrigger.modal.errors.verifyFailed'),
          })
        },
      },
    )
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
            message: 'Subscription created successfully',
          })
          onSuccess()
          onClose()
        },
        onError: (error: any) => {
          Toast.notify({
            type: 'error',
            message: error?.message || t('modal.errors.createFailed'),
          })
        },
      },
    )
  }

  const handleBack = () => {
    setCurrentStep(ApiKeyStep.Verify)
  }

  return (
    <Modal
      isShow
      onClose={onClose}
      className='!max-w-[520px] !p-0'
      wrapperClassName='!z-[1002]'
    >
      <div className='flex items-center justify-between border-b border-divider-subtle p-6 pb-4'>
        <div className='flex items-center gap-3'>
          {currentStep === ApiKeyStep.Configuration && (
            <Button variant='ghost' size='small' onClick={handleBack}>
              <RiArrowLeftLine className='h-4 w-4' />
            </Button>
          )}
          <h3 className='text-lg font-semibold text-text-primary'>
            {t('pluginTrigger.modal.apiKey.title')}
          </h3>
        </div>
        <Button variant='ghost' size='small' onClick={onClose}>
          <RiCloseLine className='h-4 w-4' />
        </Button>
      </div>

      {/* Step indicator */}
      <div className='border-b border-divider-subtle px-6 py-4'>
        <div className='flex items-center gap-4'>
          <div className={`flex items-center gap-2 ${currentStep === ApiKeyStep.Verify ? 'text-text-accent' : currentStep === ApiKeyStep.Configuration ? 'text-text-success' : 'text-text-tertiary'}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${currentStep === ApiKeyStep.Verify
              ? 'bg-util-accent-light-blue text-util-accent-blue'
              : currentStep === ApiKeyStep.Configuration
                ? 'bg-state-success-bg text-state-success-text'
                : 'bg-background-default-subtle text-text-tertiary'}`}>
              1
            </div>
            <span className='system-sm-medium'>{t('pluginTrigger.modal.steps.verify')}</span>
          </div>

          <div className='h-px flex-1 bg-divider-subtle'></div>

          <div className={`flex items-center gap-2 ${currentStep === ApiKeyStep.Configuration ? 'text-text-accent' : 'text-text-tertiary'}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${currentStep === ApiKeyStep.Configuration
              ? 'bg-util-accent-light-blue text-util-accent-blue'
              : 'bg-background-default-subtle text-text-tertiary'}`}>
              2
            </div>
            <span className='system-sm-medium'>{t('pluginTrigger.modal.steps.configuration')}</span>
          </div>
        </div>
      </div>

      <div className='p-6'>
        {currentStep === ApiKeyStep.Verify ? (
          // Step 1: Verify Credentials
          <div>

            {credentialsSchema.length > 0 && (
              <div className='mb-4'>
                <Form
                  formSchemas={credentialsSchema}
                  ref={credentialsFormRef}
                />
              </div>
            )}

            {verificationError && (
              <div className='bg-state-destructive-bg mb-4 rounded-lg border border-state-destructive-border p-3'>
                <div className='text-state-destructive-text system-xs-medium'>
                  {verificationError}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Step 2: Configuration
          <div>
            {/* <div className='mb-4'>
              <h4 className='system-sm-semibold mb-2 text-text-primary'>
                {t('pluginTrigger.modal.apiKey.configuration.title')}
              </h4>
              <p className='system-xs-regular text-text-secondary'>
                {t('pluginTrigger.modal.apiKey.configuration.description')}
              </p>
            </div> */}

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
                <div className='system-sm-medium mb-3 text-text-primary'>
                  Subscription Parameters
                </div>
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

        {currentStep === ApiKeyStep.Verify ? (
          <Button
            variant='primary'
            onClick={handleVerify}
            loading={isCreatingBuilder || isVerifying}
          // disabled={credentialsSchema.length > 0}
          >
            {isVerifying ? t('pluginTrigger.modal.common.verifying') : t('pluginTrigger.modal.common.verify')}
            <RiArrowRightLine className='ml-2 h-4 w-4' />
          </Button>
        ) : (
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

export default ApiKeyAddModal
