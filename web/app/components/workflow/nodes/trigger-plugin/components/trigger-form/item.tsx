'use client'
import type { FC } from 'react'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Event } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { PluginTriggerVarInputs } from '@/app/components/workflow/nodes/trigger-plugin/types'
import {
  RiBracesLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { SchemaModal } from '@/app/components/plugins/plugin-detail-panel/tool-selector/components'
import FormInputItem from '@/app/components/workflow/nodes/_base/components/form-input-item'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: PluginTriggerVarInputs
  onChange: (value: PluginTriggerVarInputs) => void
  inPanel?: boolean
  currentEvent?: Event
  currentProvider?: TriggerWithProvider
  extraParams?: Record<string, any>
  disableVariableInsertion?: boolean
}

const TriggerFormItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentEvent,
  currentProvider,
  extraParams,
  disableVariableInsertion = false,
}) => {
  const language = useLanguage()
  const { name, label, type, required, tooltip, input_schema } = schema
  const showSchemaButton = type === FormTypeEnum.object || type === FormTypeEnum.array
  const showDescription = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
  const [isShowSchema, {
    setTrue: showSchema,
    setFalse: hideSchema,
  }] = useBoolean(false)
  return (
    <div className="space-y-0.5 py-1">
      <div>
        <div className="flex h-6 items-center">
          <div className="system-sm-medium text-text-secondary">{label[language] || label.en_US}</div>
          {required && (
            <div className="system-xs-regular ml-1 text-text-destructive-secondary">*</div>
          )}
          {!showDescription && tooltip && (
            <Tooltip
              popupContent={(
                <div className="w-[200px]">
                  {tooltip[language] || tooltip.en_US}
                </div>
              )}
              triggerClassName="ml-1 w-4 h-4"
              asChild={false}
            />
          )}
          {showSchemaButton && (
            <>
              <div className="system-xs-regular ml-1 mr-0.5 text-text-quaternary">·</div>
              <Button
                variant="ghost"
                size="small"
                onClick={showSchema}
                className="system-xs-regular px-1 text-text-tertiary"
              >
                <RiBracesLine className="mr-1 size-3.5" />
                <span>JSON Schema</span>
              </Button>
            </>
          )}
        </div>
        {showDescription && tooltip && (
          <div className="body-xs-regular pb-0.5 text-text-tertiary">{tooltip[language] || tooltip.en_US}</div>
        )}
      </div>
      <FormInputItem
        readOnly={readOnly}
        nodeId={nodeId}
        schema={schema}
        value={value}
        onChange={onChange}
        inPanel={inPanel}
        currentTool={currentEvent}
        currentProvider={currentProvider}
        providerType="trigger"
        extraParams={extraParams}
        disableVariableInsertion={disableVariableInsertion}
      />

      {isShowSchema && (
        <SchemaModal
          isShow
          onClose={hideSchema}
          rootName={name}
          schema={input_schema!}
        />
      )}
    </div>
  )
}
export default TriggerFormItem
