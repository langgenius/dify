'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDefaultValue, toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useInvalidateTriggerSubscriptions } from '@/service/use-triggers'
import { useToastContext } from '@/app/components/base/toast'
import { findMissingRequiredField, sanitizeFormValues } from '../utils/form-helpers'
import { useTriggerAuthFlow } from '../hooks/use-trigger-auth-flow'
import ParametersForm from './parameters-form'

type ApiKeyConfigModalProps = {
  provider: TriggerWithProvider
  onCancel: () => void
  onSuccess: () => void
}

const ApiKeyConfigModal: FC<ApiKeyConfigModalProps> = ({
  provider,
  onCancel,
  onSuccess,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const language = useLanguage()
  const invalidateSubscriptions = useInvalidateTriggerSubscriptions()

  const [credentialSchema, setCredentialSchema] = useState<any[]>([])
  const [credentials, setCredentials] = useState<Record<string, any>>({})
  const [parameters, setParameters] = useState<Record<string, any>>({})
  const [properties, setProperties] = useState<Record<string, any>>({})
  const [subscriptionName, setSubscriptionName] = useState<string>('')

  const {
    step,
    builderId,
    isLoading,
    error,
    startAuth,
    verifyAuth,
    completeConfig,
    reset,
  } = useTriggerAuthFlow(provider)

  useEffect(() => {
    if (provider.credentials_schema) {
      const schemas = toolCredentialToFormSchemas(provider.credentials_schema as any)
      setCredentialSchema(schemas)
      const defaultCredentials = addDefaultValue({}, schemas)
      setCredentials(sanitizeFormValues(defaultCredentials))
    }
  }, [provider.credentials_schema])

  useEffect(() => {
    startAuth().catch((err) => {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.failedToStart', { error: err.message }),
      })
    })

    return () => {
      reset()
    }
  }, []) // Remove dependencies to run only once on mount

  const handleCredentialsSubmit = async () => {
    const requiredFields = credentialSchema
      .filter(field => field.required)
      .map(field => ({
        name: field.name,
        label: field.label[language] || field.label.en_US,
      }))

    const missingField = findMissingRequiredField(credentials, requiredFields)
    if (missingField) {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', {
          field: missingField.label,
        }),
      })
      return
    }

    try {
      await verifyAuth(credentials)
      notify({
        type: 'success',
        message: t('workflow.nodes.triggerPlugin.credentialsVerified'),
      })
    }
    catch (err: any) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.credentialVerificationFailed', {
          error: err.message,
        }),
      })
    }
  }

  const handleFinalSubmit = async () => {
    if (!subscriptionName.trim()) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.subscriptionNameRequired'),
      })
      return
    }

    try {
      await completeConfig(parameters, properties, subscriptionName)

      invalidateSubscriptions(provider.name)
      notify({
        type: 'success',
        message: t('workflow.nodes.triggerPlugin.configurationComplete'),
      })
      onSuccess()
    }
    catch (err: any) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.configurationFailed', { error: err.message }),
      })
    }
  }

  const getTitle = () => {
    switch (step) {
      case 'auth':
        return t('workflow.nodes.triggerPlugin.configureApiKey')
      case 'params':
        return t('workflow.nodes.triggerPlugin.configureParameters')
      case 'complete':
        return t('workflow.nodes.triggerPlugin.configurationComplete')
      default:
        return t('workflow.nodes.triggerPlugin.configureApiKey')
    }
  }

  const getDescription = () => {
    switch (step) {
      case 'auth':
        return t('workflow.nodes.triggerPlugin.apiKeyDescription')
      case 'params':
        return t('workflow.nodes.triggerPlugin.parametersDescription')
      case 'complete':
        return t('workflow.nodes.triggerPlugin.configurationCompleteDescription')
      default:
        return ''
    }
  }

  const renderContent = () => {
    if (credentialSchema.length === 0 && step === 'auth')
      return <Loading type='app' />

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-8">
          <p className="mb-4 text-text-destructive">{error}</p>
          <div className="flex space-x-2">
            <Button onClick={onCancel}>
              {t('common.operation.cancel')}
            </Button>
            <Button variant="primary" onClick={() => reset()}>
              {t('common.operation.retry')}
            </Button>
          </div>
        </div>
      )
    }

    switch (step) {
      case 'auth':
        return (
          <>
            <Form
              value={credentials}
              onChange={setCredentials}
              formSchemas={credentialSchema}
              isEditMode={true}
              showOnVariableMap={{}}
              validating={false}
              inputClassName='!bg-components-input-bg-normal'
              fieldMoreInfo={item => item.url ? (
                <a
                  href={item.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='inline-flex items-center text-xs text-text-accent'
                >
                  {t('tools.howToGet')}
                  <LinkExternal02 className='ml-1 h-3 w-3' />
                </a>
              ) : null}
            />
            <div className='mt-4 flex justify-end space-x-2'>
              <Button onClick={onCancel}>
                {t('common.operation.cancel')}
              </Button>
              <Button
                loading={isLoading}
                disabled={isLoading}
                variant='primary'
                onClick={handleCredentialsSubmit}
              >
                {t('workflow.nodes.triggerPlugin.verifyAndContinue')}
              </Button>
            </div>
          </>
        )

      case 'params':
        return (
          <ParametersForm
            provider={provider}
            builderId={builderId}
            parametersValue={parameters}
            propertiesValue={properties}
            subscriptionName={subscriptionName}
            onParametersChange={setParameters}
            onPropertiesChange={setProperties}
            onSubscriptionNameChange={setSubscriptionName}
            onSubmit={handleFinalSubmit}
            onCancel={onCancel}
            isLoading={isLoading}
          />
        )

      case 'complete':
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="bg-background-success-emphasis mb-4 flex h-12 w-12 items-center justify-center rounded-full">
              <svg className="h-6 w-6 text-text-success" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="mb-4 text-center text-text-primary">
              {t('workflow.nodes.triggerPlugin.configurationCompleteMessage')}
            </p>
            <Button variant="primary" onClick={onSuccess}>
              {t('common.operation.done')}
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Drawer
      isShow
      onHide={onCancel}
      title={getTitle()}
      titleDescription={getDescription()}
      panelClassName='mt-[64px] mb-2 !w-[420px] border-components-panel-border'
      maxWidthClassName='!max-w-[420px]'
      height='calc(100vh - 64px)'
      contentClassName='!bg-components-panel-bg'
      headerClassName='!border-b-divider-subtle'
      body={
        <div className='h-full px-6 py-3'>
          {renderContent()}
        </div>
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}

export default React.memo(ApiKeyConfigModal)
