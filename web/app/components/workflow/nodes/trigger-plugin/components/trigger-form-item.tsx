'use client'
import type { FC } from 'react'
import {
  RiBracesLine,
} from '@remixicon/react'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import FormInputItem from '@/app/components/workflow/nodes/_base/components/form-input-item'
import { useBoolean } from 'ahooks'
import SchemaModal from '@/app/components/plugins/plugin-detail-panel/tool-selector/schema-modal'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { Tool } from '@/app/components/tools/types'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: Record<string, any>
  onChange: (value: Record<string, any>) => void
  inPanel?: boolean
  currentTrigger?: Tool
  currentProvider?: TriggerWithProvider
  extraParams?: Record<string, any>
}

const TriggerFormItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentTrigger,
  currentProvider,
  extraParams,
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
    <div className='space-y-0.5 py-1'>
      <div className='flex items-center'>
        <div className="flex shrink-0 items-center space-x-1">
          <div className='system-sm-medium text-text-secondary'>
            {label?.[language] || label?.en_US || name}
            {required && <span className='ml-1 text-text-destructive'>*</span>}
          </div>
          {showSchemaButton && (
            <Tooltip
              popupContent={label?.[language] || label?.en_US || name}
            >
              <Button
                className='h-4 w-4 rounded !border-none bg-transparent p-0 !shadow-none hover:bg-state-base-hover'
                onClick={showSchema}
              >
                <RiBracesLine className='h-3 w-3 text-text-tertiary' />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      <div>
        <FormInputItem
          readOnly={readOnly}
          nodeId={nodeId}
          schema={schema}
          value={value}
          onChange={onChange}
          showDescription={showDescription}
          inPanel={inPanel}
          currentTool={currentTrigger}
          currentProvider={currentProvider as any}
          extraParams={extraParams}
          isTrigger={true}
        />
      </div>
      {tooltip && (
        <div className='text-xs leading-4 text-text-tertiary'>
          {tooltip[language] || tooltip.en_US}
        </div>
      )}
      {isShowSchema && (
        <SchemaModal
          isShow={isShowSchema}
          onClose={hideSchema}
          schema={input_schema}
        />
      )}
    </div>
  )
}

export default TriggerFormItem
