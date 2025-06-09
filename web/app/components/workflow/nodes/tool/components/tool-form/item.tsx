'use client'
import type { FC } from 'react'
import {
  RiBracesLine,
} from '@remixicon/react'
import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import FormInputItem from '@/app/components/workflow/nodes/_base/components/form-input-item'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
  showDescription?: boolean
}

const ToolFormItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  showDescription,
}) => {
  const language = useLanguage()
  const { label, type, required, tooltip } = schema
  const showSchemaButton = type === FormTypeEnum.object || type === FormTypeEnum.array

  return (
    <div className='space-y-0.5 py-1'>
      <div>
        <div className='flex h-6 items-center'>
          <div className='system-sm-medium text-text-secondary'>{label[language] || label.en_US}</div>
          {required && (
            <div className='system-xs-regular ml-1 text-text-destructive-secondary'>*</div>
          )}
          {!showDescription && tooltip && (
            <Tooltip
              popupContent={<div className='w-[200px]'>
                {tooltip[language] || tooltip.en_US}
              </div>}
              triggerClassName='ml-1 w-4 h-4'
              asChild={false}
            />
          )}
          {showSchemaButton && (
            <>
              <div className='system-xs-regular ml-1 text-text-quaternary'>·</div>
              <Button
                variant='ghost'
                size='small'
                onClick={() => {
                  // onOpen?.(index)
                }}
              >
                <RiBracesLine className='mr-1' />
                <span>JSON Schema</span>
              </Button>
            </>
          )}
        </div>
        {showDescription && tooltip && (
          <div className='body-xs-regular pb-0.5 text-text-tertiary'>{tooltip[language] || tooltip.en_US}</div>
        )}
      </div>
      <FormInputItem
        readOnly={readOnly}
        nodeId={nodeId}
        schema={schema}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}
export default ToolFormItem
