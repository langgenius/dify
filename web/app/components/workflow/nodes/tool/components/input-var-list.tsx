'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import type { ToolVarInputs } from '../types'
import { VarType as VarKindType } from '../types'
import cn from '@/utils/classnames'
import type { ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import { noop } from 'lodash-es'
import type { Tool } from '@/app/components/tools/types'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
  isSupportConstantValue?: boolean
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
  currentTool?: Tool
  currentProvider?: ToolWithProvider
}

const InputVarList: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  onOpen = noop,
  isSupportConstantValue,
  filterVar,
  currentTool,
  currentProvider,
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
    else if (type === FormTypeEnum.file || type === FormTypeEnum.files)
      return 'Files'
    else if (type === FormTypeEnum.appSelector)
      return 'AppSelector'
    else if (type === FormTypeEnum.modelSelector)
      return 'ModelSelector'
    else if (type === FormTypeEnum.toolSelector)
      return 'ToolSelector'
    else if (type === FormTypeEnum.dynamicSelect || type === FormTypeEnum.select)
      return 'Select'
    else
      return 'String'
  }

  const handleNotMixedTypeChange = useCallback((variable: string) => {
    return (varValue: ValueSelector | string, varKindType: VarKindType) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        const target = draft[variable]
        if (target) {
          target.type = varKindType
          target.value = varValue
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
  }, [value, onChange])

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

  const handleFileChange = useCallback((variable: string) => {
    return (varValue: ValueSelector | string) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        draft[variable] = {
          type: VarKindType.variable,
          value: varValue,
        }
      })
      onChange(newValue)
    }
  }, [value, onChange])

  const handleAppChange = useCallback((variable: string) => {
    return (app: {
      app_id: string
      inputs: Record<string, any>
      files?: any[]
    }) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        draft[variable] = app as any
      })
      onChange(newValue)
    }
  }, [onChange, value])
  const handleModelChange = useCallback((variable: string) => {
    return (model: any) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        draft[variable] = {
          ...draft[variable],
          ...model,
        } as any
      })
      onChange(newValue)
    }
  }, [onChange, value])

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
            scope,
          } = schema
          const varInput = value[variable]
          const isNumber = type === FormTypeEnum.textNumber
          const isDynamicSelect = type === FormTypeEnum.dynamicSelect
          const isSelect = type === FormTypeEnum.select || type === FormTypeEnum.dynamicSelect
          const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
          const isAppSelector = type === FormTypeEnum.appSelector
          const isModelSelector = type === FormTypeEnum.modelSelector
          // const isToolSelector = type === FormTypeEnum.toolSelector
          const isString = !isNumber && !isSelect && !isFile && !isAppSelector && !isModelSelector

          return (
            <div key={variable} className='space-y-1'>
              <div className='flex h-[18px] items-center space-x-2'>
                <span className='code-sm-semibold text-text-secondary'>{label[language] || label.en_US}</span>
                <span className='system-xs-regular text-text-tertiary'>{paramType(type)}</span>
                {required && <span className='system-xs-regular text-util-colors-orange-dark-orange-dark-600'>Required</span>}
              </div>
              {isString && (
                <Input
                  className={cn(inputsIsFocus[variable] ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs' : 'border-components-input-border-hover bg-components-input-bg-normal', 'rounded-lg border px-3 py-[6px]')}
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
                  value={varInput?.type === VarKindType.constant ? (varInput?.value ?? '') : (varInput?.value ?? [])}
                  onChange={handleNotMixedTypeChange(variable)}
                  onOpen={handleOpen(index)}
                  defaultVarKindType={varInput?.type || ((isNumber || isDynamicSelect) ? VarKindType.constant : VarKindType.variable)}
                  isSupportConstantValue={isSupportConstantValue}
                  filterVar={isNumber ? filterVar : undefined}
                  availableVars={isSelect ? availableVars : undefined}
                  schema={schema}
                  currentTool={currentTool}
                  currentProvider={currentProvider}
                />
              )}
              {isFile && (
                <VarReferencePicker
                  readonly={readOnly}
                  isShowNodeName
                  nodeId={nodeId}
                  value={varInput?.value || []}
                  onChange={handleFileChange(variable)}
                  onOpen={handleOpen(index)}
                  defaultVarKindType={VarKindType.variable}
                  filterVar={(varPayload: Var) => varPayload.type === VarType.file || varPayload.type === VarType.arrayFile}
                />
              )}
              {isAppSelector && (
                <AppSelector
                  disabled={readOnly}
                  scope={scope || 'all'}
                  value={varInput as any}
                  onSelect={handleAppChange(variable)}
                />
              )}
              {isModelSelector && (
                <ModelParameterModal
                  popupClassName='!w-[387px]'
                  isAdvancedMode
                  isInWorkflow
                  value={varInput as any}
                  setModel={handleModelChange(variable)}
                  readonly={readOnly}
                  scope={scope}
                />
              )}
              {tooltip && <div className='body-xs-regular text-text-tertiary'>{tooltip[language] || tooltip.en_US}</div>}
            </div>
          )
        })
      }
    </div>
  )
}
export default React.memo(InputVarList)
