import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import {
  RiArrowRightUpLine,
} from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Node } from 'reactflow'
import type {
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  value: Record<string, any>
  onChange: (val: Record<string, any>) => void
  schemas: any[]
  nodeOutputVars: NodeOutPutVar[],
  availableNodes: Node[],
  nodeId: string
}

const ReasoningConfigForm: React.FC<Props> = ({
  value,
  onChange,
  schemas,
  nodeOutputVars,
  availableNodes,
  nodeId,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const handleAutomatic = (key: string, val: any) => {
    onChange({
      ...value,
      [key]: {
        value: val ? null : value[key]?.value,
        auto: val ? 1 : 0,
      },
    })
  }

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
  const handleNotMixedTypeChange = useCallback((variable: string) => {
    return (varValue: ValueSelector | string, varKindType: VarKindType) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        const target = draft[variable].value
        if (target) {
          target.type = varKindType
          target.value = varValue
        }
        else {
          draft[variable].value = {
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
        const target = draft[variable].value
        if (target) {
          target.value = itemValue
        }
        else {
          draft[variable].value = {
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
        draft[variable].value = {
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
        draft[variable].value = app as any
      })
      onChange(newValue)
    }
  }, [onChange, value])
  const handleModelChange = useCallback((variable: string) => {
    return (model: any) => {
      const newValue = produce(value, (draft: ToolVarInputs) => {
        draft[variable].value = {
          ...draft[variable].value,
          ...model,
        } as any
      })
      onChange(newValue)
    }
  }, [onChange, value])

  const renderField = (schema: any) => {
    const {
      variable,
      label,
      required,
      tooltip,
      type,
      scope,
      url,
    } = schema
    const auto = value[variable]?.auto
    const tooltipContent = (tooltip && (
      <Tooltip
        popupContent={<div className='w-[200px]'>
          {tooltip[language] || tooltip.en_US}
        </div>}
        triggerClassName='ml-1 w-4 h-4'
        asChild={false} />
    ))
    const varInput = value[variable].value
    const isNumber = type === FormTypeEnum.textNumber
    const isSelect = type === FormTypeEnum.select
    const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
    const isAppSelector = type === FormTypeEnum.appSelector
    const isModelSelector = type === FormTypeEnum.modelSelector
    // const isToolSelector = type === FormTypeEnum.toolSelector
    const isString = !isNumber && !isSelect && !isFile && !isAppSelector && !isModelSelector
    return (
      <div key={variable} className='space-y-1'>
        <div className='system-sm-semibold text-text-secondary flex items-center justify-between py-2'>
          <div className='flex items-center space-x-2'>
            <span className={cn('text-text-secondary code-sm-semibold')}>{label[language] || label.en_US}</span>
            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
          </div>
          <div className='border-divider-subtle bg-background-default-lighter hover:bg-state-base-hover flex cursor-pointer items-center gap-1 rounded-[6px] border px-2 py-1' onClick={() => handleAutomatic(variable, !auto)}>
            <span className='text-text-secondary system-xs-medium'>{t('plugin.detailPanel.toolSelector.auto')}</span>
            <Switch
              size='xs'
              defaultValue={!!auto}
              onChange={val => handleAutomatic(variable, val)}
            />
          </div>
        </div>
        {auto === 0 && (
          <>
            {isString && (
              <Input
                className={cn(inputsIsFocus[variable] ? 'shadow-xs border-gray-300 bg-gray-50' : 'border-gray-100 bg-gray-100', 'rounded-lg border px-3 py-[6px]')}
                value={varInput?.value as string || ''}
                onChange={handleMixedTypeChange(variable)}
                nodesOutputVars={nodeOutputVars}
                availableNodes={availableNodes}
                onFocusChange={handleInputFocus(variable)}
                placeholder={t('workflow.nodes.http.insertVarPlaceholder')!}
                placeholderClassName='!leading-[21px]'
              />
            )}
            {/* {isString && (
              <VarReferencePicker
                zIndex={1001}
                readonly={false}
                isShowNodeName
                nodeId={nodeId}
                value={varInput?.value || ''}
                onChange={handleNotMixedTypeChange(variable)}
                defaultVarKindType={VarKindType.variable}
                filterVar={(varPayload: Var) => varPayload.type === VarType.number || varPayload.type === VarType.secret || varPayload.type === VarType.string}
              />
            )} */}
            {(isNumber || isSelect) && (
              <VarReferencePicker
                zIndex={1001}
                readonly={false}
                isShowNodeName
                nodeId={nodeId}
                value={varInput?.type === VarKindType.constant ? (varInput?.value ?? '') : (varInput?.value ?? [])}
                onChange={handleNotMixedTypeChange(variable)}
                defaultVarKindType={varInput?.type || (isNumber ? VarKindType.constant : VarKindType.variable)}
                isSupportConstantValue
                filterVar={isNumber ? (varPayload: Var) => varPayload.type === schema._type : undefined}
                availableVars={isSelect ? nodeOutputVars : undefined}
                schema={schema}
              />
            )}
            {isFile && (
              <VarReferencePicker
                zIndex={1001}
                readonly={false}
                isShowNodeName
                nodeId={nodeId}
                value={varInput?.value || []}
                onChange={handleFileChange(variable)}
                defaultVarKindType={VarKindType.variable}
                filterVar={(varPayload: Var) => varPayload.type === VarType.file || varPayload.type === VarType.arrayFile}
              />
            )}
            {isAppSelector && (
              <AppSelector
                disabled={false}
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
                scope={scope}
              />
            )}
          </>
        )}
        {url && (
          <a
            href={url}
            target='_blank' rel='noopener noreferrer'
            className='text-text-accent inline-flex items-center text-xs'
          >
            {t('tools.howToGet')}
            <RiArrowRightUpLine className='ml-1 h-3 w-3' />
          </a>
        )}
      </div>
    )
  }
  return (
    <div className='space-y-3 px-4 py-2'>
      {schemas.map(schema => renderField(schema))}
    </div>
  )
}

export default ReasoningConfigForm
