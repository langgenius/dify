'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import type { ToolVarInput } from '../types'
import { VarType } from '../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: ToolVarInput[]
  onChange: (value: ToolVarInput[]) => void
}

const InputVarList: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
}) => {
  const language = useLanguage()

  const keyValues = (() => {
    const res: Record<string, ToolVarInput> = {}
    value.forEach((item) => {
      res[item.variable] = item
    })
    return res
  })()

  const handleChange = useCallback((variable: string) => {
    return (varValue: any) => {
      const newValue = produce(value, (draft: ToolVarInput[]) => {
        const target = draft.find(item => item.variable === variable)
        if (target) {
          target.value_selector = varValue // TODO: support constant value
        }
        else {
          draft.push({
            variable,
            variable_type: VarType.selector, // TODO: support constant value
            value_selector: varValue,
          })
        }
      })
      onChange(newValue)
    }
  }, [value, onChange])

  return (
    <div className='space-y-3'>
      {
        schema.map(({
          variable,
          label,
          type,
          required,
          tooltip,
        }) => {
          const varInput = keyValues[variable]
          return (
            <div key={variable} className='space-y-1'>
              <div className='flex items-center h-[18px] space-x-2'>
                <span className='text-[13px] font-medium text-gray-900'>{label[language] || label.en_US}</span>
                <span className='text-xs font-normal text-gray-500'>{type === FormTypeEnum.textNumber ? 'Number' : 'String'}</span>
                {required && <span className='leading-[18px] text-xs font-normal text-[#EC4A0A]'>Required</span>}
              </div>
              <VarReferencePicker
                readonly={readOnly}
                isShowNodeName
                nodeId={nodeId}
                value={varInput?.value_selector || []} // TODO: support constant value
                onChange={handleChange(variable)}
              />
              {tooltip && <div className='leading-[18px] text-xs font-normal text-gray-600'>{tooltip[language] || tooltip.en_US}</div>}
            </div>
          )
        })
      }
    </div>
  )
}
export default React.memo(InputVarList)
