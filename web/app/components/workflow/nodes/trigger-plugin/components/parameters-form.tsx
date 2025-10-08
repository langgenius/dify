'use client'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { Event } from '@/app/components/tools/types'
import { toolCredentialToFormSchemas, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import TriggerForm from './trigger-form'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'

type ParametersFormProps = {
  provider: TriggerWithProvider
  trigger?: Event
  builderId: string
  parametersValue: Record<string, any>
  propertiesValue: Record<string, any>
  subscriptionName: string
  onParametersChange: (value: Record<string, any>) => void
  onPropertiesChange: (value: Record<string, any>) => void
  onSubscriptionNameChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  isLoading?: boolean
  readOnly?: boolean
}

const ParametersForm: FC<ParametersFormProps> = ({
  provider,
  trigger,
  builderId,
  parametersValue,
  propertiesValue,
  subscriptionName,
  onParametersChange,
  onPropertiesChange,
  onSubscriptionNameChange,
  onSubmit,
  onCancel,
  isLoading = false,
  readOnly = false,
}) => {
  const { t } = useTranslation()

  // Use the first trigger if no specific trigger is provided
  // This is needed for dynamic options API which requires a trigger action
  const currentTrigger = trigger || provider.triggers?.[0]

  const parametersSchema = useMemo(() => {
    if (!provider.subscription_schema?.parameters_schema) return []
    return toolParametersToFormSchemas(provider.subscription_schema.parameters_schema as any)
  }, [provider.subscription_schema?.parameters_schema])

  const propertiesSchema = useMemo(() => {
    if (!provider.subscription_schema?.properties_schema) return []
    return toolCredentialToFormSchemas(provider.subscription_schema.properties_schema as any)
  }, [provider.subscription_schema?.properties_schema])

  const hasParameters = parametersSchema.length > 0
  const hasProperties = propertiesSchema.length > 0

  if (!hasParameters && !hasProperties) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <p className="mb-4 text-text-tertiary">
          {t('workflow.nodes.triggerPlugin.noConfigurationRequired')}
        </p>
        <div className="flex space-x-2">
          <Button onClick={onCancel}>
            {t('common.operation.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            loading={isLoading}
            disabled={isLoading}
          >
            {t('common.operation.save')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Subscription Name Section */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">
            {t('workflow.nodes.triggerPlugin.subscriptionName')}
          </h3>
          <p className="text-xs text-text-tertiary">
            {t('workflow.nodes.triggerPlugin.subscriptionNameDescription')}
          </p>
        </div>
        <Input
          value={subscriptionName}
          onChange={e => onSubscriptionNameChange(e.target.value)}
          placeholder={t('workflow.nodes.triggerPlugin.subscriptionNamePlaceholder')}
          readOnly={readOnly}
        />
      </div>

      {/* Parameters Section */}
      {hasParameters && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium text-text-primary">
              {t('workflow.nodes.triggerPlugin.parameters')}
            </h3>
            <p className="text-xs text-text-tertiary">
              {t('workflow.nodes.triggerPlugin.parametersDescription')}
            </p>
          </div>
          <TriggerForm
            readOnly={readOnly}
            nodeId=""
            schema={parametersSchema as any}
            value={parametersValue}
            onChange={onParametersChange}
            currentTrigger={currentTrigger}
            currentProvider={provider}
            extraParams={{ subscription_builder_id: builderId }}
          />
        </div>
      )}

      {/* Properties Section */}
      {hasProperties && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium text-text-primary">
              {t('workflow.nodes.triggerPlugin.properties')}
            </h3>
            <p className="text-xs text-text-tertiary">
              {t('workflow.nodes.triggerPlugin.propertiesDescription')}
            </p>
          </div>
          <TriggerForm
            readOnly={readOnly}
            nodeId=""
            schema={propertiesSchema as any}
            value={propertiesValue}
            onChange={onPropertiesChange}
            currentTrigger={currentTrigger}
            currentProvider={provider}
            extraParams={{ subscription_builder_id: builderId }}
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end space-x-2 border-t border-divider-subtle pt-4">
        <Button onClick={onCancel}>
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          loading={isLoading}
          disabled={isLoading}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </div>
  )
}

export default ParametersForm
