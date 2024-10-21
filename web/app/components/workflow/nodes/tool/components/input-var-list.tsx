'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import type { ToolVarInputs } from '../types'
import { VarType as VarKindType } from '../types'
import cn from '@/utils/classnames'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
  isSupportConstantValue?: boolean
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
}

const InputVarList: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  onOpen = () => { },
  isSupportConstantValue,
  filterVar,
}) => {
  const language = useLanguage()
  const { t } = useTranslation()
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })
  const paramType = (type: string) => {
    if (type === FormTypeEnum.textNumber)
      return 'Number'
    else if (type === FormTypeEnum.files)
      return 'Files'
    else if (type === FormTypeEnum.select)
      return 'Options'
    else
      return 'String'
  }

  const handleNotMixedTypeChange = useCallback((variable: string) => {
    return (varValue: ValueSelector | string, varKindType: VarKindType) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        const target = draft[variable]
        if (target) {
          if (!isSupportConstantValue || varKindType === VarKindType.variable) {
            if (isSupportConstantValue)
              target.type = VarKindType.variable

            target.value = varValue as ValueSelector
          }
          else {
            target.type = VarKindType.constant
            target.value = varValue as string
          }
        }
        else {
          draft[variable] = {
            type: varKindType,
            value: varValue,
          }
        }
      })
      onChange(newValue)
    }
  }, [value, onChange, isSupportConstantValue])

  const handleMixedTypeChange = useCallback((variable: string) => {
    return (itemValue: string) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        const target = draft[variable]
        if (target) {
          target.value = itemValue
        }
        else {
          draft[variable] = {
            type: VarKindType.mixed,
            value: itemValue,
          }
        }
      })
      onChange(newValue)
    }
  }, [value, onChange])

  const [inputsIsFocus, setInputsIsFocus] = useState<Record<string, boolean>>({})
  const handleInputFocus = useCallback((variable: string) => {
    return (value: boolean) => {
      setInputsIsFocus((prev) => {
        return {
          ...prev,
          [variable]: value,
        }
      })
    }
  }, [])
  const handleOpen = useCallback((index: number) => {
    return () => onOpen(index)
  }, [onOpen])
  return (
    <div className='space-y-3'>
      {
        schema.map((schema, index) => {
          const {
            variable,
            label,
            type,
            required,
            tooltip,
          } = schema
          const varInput = value[variable]
          const isNumber = type === FormTypeEnum.textNumber
          const isSelect = type === FormTypeEnum.select
          const isFile = type === FormTypeEnum.file
          const isFileArray = type === FormTypeEnum.files
          const isString = type !== FormTypeEnum.textNumber && type !== FormTypeEnum.files && type !== FormTypeEnum.select
          return (
            <div key={variable} className='space-y-1'>
              <div className='flex items-center h-[18px] space-x-2'>
                <span className='text-text-secondary code-sm-semibold'>{label[language] || label.en_US}</span>
                <span className='text-text-tertiary system-xs-regular'>{paramType(type)}</span>
                {required && <span className='text-util-colors-orange-dark-orange-dark-600 system-xs-regular'>Required</span>}
              </div>
              {isString && (
                <Input
                  className={cn(inputsIsFocus[variable] ? 'shadow-xs bg-gray-50 border-gray-300' : 'bg-gray-100 border-gray-100', 'rounded-lg px-3 py-[6px] border')}
                  value={varInput?.value as string || ''}
                  onChange={handleMixedTypeChange(variable)}
                  readOnly={readOnly}
                  nodesOutputVars={availableVars}
                  availableNodes={availableNodesWithParent}
                  onFocusChange={handleInputFocus(variable)}
                  placeholder={t('workflow.nodes.http.insertVarPlaceholder')!}
                  placeholderClassName='!leading-[21px]'
                />
              )}
              {(isNumber || isSelect) && (
                <VarReferencePicker
                  readonly={readOnly}
                  isShowNodeName
                  nodeId={nodeId}
                  value={varInput?.type === VarKindType.constant ? (varInput?.value || '') : (varInput?.value || [])}
                  onChange={handleNotMixedTypeChange(variable)}
                  onOpen={handleOpen(index)}
                  isSupportConstantValue={isSupportConstantValue}
                  defaultVarKindType={varInput?.type}
                  filterVar={isNumber ? filterVar : undefined}
                  availableVars={isSelect ? availableVars : undefined}
                  schema={schema}
                />
              )}
              {isFile && (
                <VarReferencePicker
                  readonly={readOnly}
                  isShowNodeName
                  nodeId={nodeId}
                  value={varInput?.type === VarKindType.constant ? (varInput?.value || '') : (varInput?.value || [])}
                  onChange={handleNotMixedTypeChange(variable)}
                  onOpen={handleOpen(index)}
                  defaultVarKindType={VarKindType.variable}
                  filterVar={(varPayload: Var) => varPayload.type === VarType.file}
                />
              )}
              {isFileArray && (
                <VarReferencePicker
                  readonly={readOnly}
                  isShowNodeName
                  nodeId={nodeId}
                  value={varInput?.type === VarKindType.constant ? (varInput?.value || '') : (varInput?.value || [])}
                  onChange={handleNotMixedTypeChange(variable)}
                  onOpen={handleOpen(index)}
                  defaultVarKindType={VarKindType.variable}
                  filterVar={(varPayload: Var) => varPayload.type === VarType.arrayFile}
                />
              )}
              {tooltip && <div className='text-text-tertiary body-xs-regular'>{tooltip[language] || tooltip.en_US}</div>}
            </div>
          )
        })
      }
    </div>
  )
}
export default React.memo(InputVarList)
