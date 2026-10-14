'use client'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Event } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { PluginTriggerVarInputs } from '@/app/components/workflow/nodes/trigger-plugin/types'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { SchemaDialog } from '@/app/components/plugins/plugin-detail-panel/tool-selector/components/schema-dialog'
import FormInputItem from '@/app/components/workflow/nodes/_base/components/form-input-item'

type Props = Readonly<{
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: PluginTriggerVarInputs
  onChange: (value: PluginTriggerVarInputs) => void
  currentEvent?: Event
  currentProvider?: TriggerWithProvider
  extraParams?: Record<string, unknown>
  disableVariableInsertion?: boolean
}>

export function TriggerFormItem({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  currentEvent,
  currentProvider,
  extraParams,
  disableVariableInsertion = false,
}: Props) {
  const language = useLanguage()
  const labelId = useId()
  const { name, label, type, required, tooltip, input_schema } = schema
  const showSchemaButton = type === FormTypeEnum.object || type === FormTypeEnum.array
  const showDescription =
    type === FormTypeEnum.textInput ||
    type === FormTypeEnum.textNumber ||
    type === FormTypeEnum.secretInput ||
    type === FormTypeEnum.date ||
    type === FormTypeEnum.dateRange
  return (
    <div className="space-y-0.5 py-1">
      <div>
        <div className="flex h-6 items-center">
          <div id={labelId} className="system-sm-medium text-text-secondary">
            {label[language] || label.en_US}
          </div>
          {required && (
            <div className="ml-1 system-xs-regular text-text-destructive-secondary">*</div>
          )}
          {!showDescription && tooltip && (
            <Infotip>
              <InfotipTrigger aria-labelledby={labelId} className="ml-1" />
              <InfotipContent aria-labelledby={labelId} className="w-50">
                {tooltip[language] || tooltip.en_US}
              </InfotipContent>
            </Infotip>
          )}
          {showSchemaButton && (
            <>
              <div className="mr-0.5 ml-1 system-xs-regular text-text-quaternary">·</div>
              <SchemaDialog schema={input_schema} rootName={name} />
            </>
          )}
        </div>
        {showDescription && tooltip && (
          <div className="pb-0.5 body-xs-regular text-text-tertiary">
            {tooltip[language] || tooltip.en_US}
          </div>
        )}
      </div>
      <FormInputItem
        labelId={labelId}
        readOnly={readOnly}
        nodeId={nodeId}
        schema={schema}
        value={value}
        onChange={onChange}
        currentTool={currentEvent}
        currentProvider={currentProvider}
        providerType="trigger"
        extraParams={extraParams}
        disableVariableInsertion={disableVariableInsertion}
      />
    </div>
  )
}
