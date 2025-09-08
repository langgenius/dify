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
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useInvalidateTriggerSubscriptions,
  useUpdateTriggerSubscriptionBuilder,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import { useToastContext } from '@/app/components/base/toast'
import { findMissingRequiredField, sanitizeFormValues } from '../utils/form-helpers'

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
  const [credentialSchema, setCredentialSchema] = useState<any[]>([])
  const [tempCredential, setTempCredential] = useState<Record<string, any>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [subscriptionBuilderId, setSubscriptionBuilderId] = useState<string>('')

  const createBuilder = useCreateTriggerSubscriptionBuilder()
  const updateBuilder = useUpdateTriggerSubscriptionBuilder()
  const verifyBuilder = useVerifyTriggerSubscriptionBuilder()
  const buildSubscription = useBuildTriggerSubscription()
  const invalidateSubscriptions = useInvalidateTriggerSubscriptions()

  useEffect(() => {
    if (provider.credentials_schema) {
      const schemas = toolCredentialToFormSchemas(provider.credentials_schema as any)
      setCredentialSchema(schemas)
      const defaultCredentials = addDefaultValue({}, schemas)
      // Use utility function for consistent data sanitization
      setTempCredential(sanitizeFormValues(defaultCredentials))
    }
  }, [provider.credentials_schema])

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
      // Step 1: Create subscription builder
      let builderId = subscriptionBuilderId
      if (!builderId) {
        const createResponse = await createBuilder.mutateAsync({
          provider: provider.name,
          credentials: tempCredential,
        })
        builderId = createResponse.subscription_builder.id
        setSubscriptionBuilderId(builderId)
      }
      else {
        // Update existing builder
        await updateBuilder.mutateAsync({
          provider: provider.name,
          subscriptionBuilderId: builderId,
          credentials: tempCredential,
        })
      }

      // Step 2: Verify credentials
      await verifyBuilder.mutateAsync({
        provider: provider.name,
        subscriptionBuilderId: builderId,
      })

      // Step 3: Build final subscription
      await buildSubscription.mutateAsync({
        provider: provider.name,
        subscriptionBuilderId: builderId,
      })

      // Step 4: Invalidate and notify success
      invalidateSubscriptions(provider.name)
      notify({
        type: 'success',
        message: t('workflow.nodes.triggerPlugin.apiKeyConfigured'),
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
      title={t('workflow.nodes.triggerPlugin.configureApiKey')}
      titleDescription={t('workflow.nodes.triggerPlugin.apiKeyDescription')}
      panelClassName='mt-[64px] mb-2 !w-[420px] border-components-panel-border'
      maxWidthClassName='!max-w-[420px]'
      height='calc(100vh - 64px)'
      contentClassName='!bg-components-panel-bg'
      headerClassName='!border-b-divider-subtle'
      body={
        <div className='h-full px-6 py-3'>
          {credentialSchema.length === 0 ? (
            <Loading type='app' />
          ) : (
            <>
              <Form
                value={tempCredential}
                onChange={setTempCredential}
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

export default React.memo(ApiKeyConfigModal)
