'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDefaultValue, toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { TriggerOAuthClientParams, TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  useConfigureTriggerOAuth,
  useInvalidateTriggerOAuthConfig,
  useTriggerOAuthConfig,
} from '@/service/use-triggers'
import { useToastContext } from '@/app/components/base/toast'
import { findMissingRequiredField, sanitizeFormValues } from '../utils/form-helpers'

// Type-safe conversion function for dynamic OAuth client parameters
const convertToOAuthClientParams = (credentials: Record<string, any>): TriggerOAuthClientParams => {
  // Use utility function for consistent data sanitization
  const sanitizedCredentials = sanitizeFormValues(credentials)

  // Create base params with required fields
  const baseParams: TriggerOAuthClientParams = {
    client_id: sanitizedCredentials.client_id || '',
    client_secret: sanitizedCredentials.client_secret || '',
  }

  // Add optional fields if they exist
  if (sanitizedCredentials.authorization_url)
    baseParams.authorization_url = sanitizedCredentials.authorization_url
  if (sanitizedCredentials.token_url)
    baseParams.token_url = sanitizedCredentials.token_url
  if (sanitizedCredentials.scope)
    baseParams.scope = sanitizedCredentials.scope

  return baseParams
}

type OAuthClientConfigModalProps = {
  provider: TriggerWithProvider
  onCancel: () => void
  onSuccess: () => void
}

const OAuthClientConfigModal: FC<OAuthClientConfigModalProps> = ({
  provider,
  onCancel,
  onSuccess,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const language = useLanguage()
  const [credentialSchema, setCredentialSchema] = useState<any[]>([])
  const [tempCredential, setTempCredential] = useState<Record<string, any>>({})
  const [isLoading, setIsLoading] = useState(false)

  const providerPath = `${provider.plugin_id}/${provider.name}`

  const { data: oauthConfig, isLoading: isLoadingConfig } = useTriggerOAuthConfig(providerPath)
  const configureTriggerOAuth = useConfigureTriggerOAuth()
  const invalidateOAuthConfig = useInvalidateTriggerOAuthConfig()

  useEffect(() => {
    if (provider.oauth_client_schema) {
      const schemas = toolCredentialToFormSchemas(provider.oauth_client_schema as any)
      setCredentialSchema(schemas)

      // Load existing configuration if available, ensure no null values
      const existingParams = oauthConfig?.params || {}
      const defaultCredentials = addDefaultValue(existingParams, schemas)

      // Use utility function for consistent data sanitization
      setTempCredential(sanitizeFormValues(defaultCredentials))
    }
  }, [provider.oauth_client_schema, oauthConfig])

  const handleSave = async () => {
    // Validate required fields using utility function
    const requiredFields = credentialSchema
      .filter(field => field.required)
      .map(field => ({
        name: field.name,
        label: field.label[language] || field.label.en_US,
      }))

    const missingField = findMissingRequiredField(tempCredential, requiredFields)
    if (missingField) {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', {
          field: missingField.label,
        }),
      })
      return
    }

    setIsLoading(true)

    try {
      await configureTriggerOAuth.mutateAsync({
        provider: providerPath,
        client_params: convertToOAuthClientParams(tempCredential),
        enabled: true,
      })

      // Invalidate cache
      invalidateOAuthConfig(providerPath)

      notify({
        type: 'success',
        message: t('workflow.nodes.triggerPlugin.oauthClientSaved'),
      })
      onSuccess()
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.configurationFailed', { error: error.message }),
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <Drawer
      isShow
      onHide={onCancel}
      title={t('workflow.nodes.triggerPlugin.configureOAuthClient')}
      titleDescription={t('workflow.nodes.triggerPlugin.oauthClientDescription')}
      panelClassName='mt-[64px] mb-2 !w-[420px] border-components-panel-border'
      maxWidthClassName='!max-w-[420px]'
      height='calc(100vh - 64px)'
      contentClassName='!bg-components-panel-bg'
      headerClassName='!border-b-divider-subtle'
      body={
        <div className='h-full px-6 py-3'>
          {isLoadingConfig || credentialSchema.length === 0 ? (
            <Loading type='app' />
          ) : (
            <>
              <Form
                value={tempCredential}
                onChange={(value) => {
                  // Use utility function for consistent data sanitization
                  setTempCredential(sanitizeFormValues(value))
                }}
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
                  onClick={handleSave}
                >
                  {t('common.operation.save')}
                </Button>
              </div>
            </>
          )}
        </div>
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}

export default React.memo(OAuthClientConfigModal)
