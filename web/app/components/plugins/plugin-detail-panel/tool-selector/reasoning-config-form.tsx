import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import {
  RiArrowRightUpLine,
  RiBracesLine,
} from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import MixedVariableTextInput from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input'
import Input from '@/app/components/base/input'
import FormInputTypeSwitch from '@/app/components/workflow/nodes/_base/components/form-input-type-switch'
import FormInputBoolean from '@/app/components/workflow/nodes/_base/components/form-input-boolean'
import { SimpleSelect } from '@/app/components/base/select'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Node } from 'reactflow'
import type {
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import { useBoolean } from 'ahooks'
import SchemaModal from './schema-modal'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'

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
  const getVarKindType = (type: FormTypeEnum) => {
    if (type === FormTypeEnum.file || type === FormTypeEnum.files)
      return VarKindType.variable
    if (type === FormTypeEnum.select || type === FormTypeEnum.boolean || type === FormTypeEnum.textNumber || type === FormTypeEnum.array || type === FormTypeEnum.object)
      return VarKindType.constant
    if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
      return VarKindType.mixed
  }

  const handleAutomatic = (key: string, val: any, type: FormTypeEnum) => {
    onChange({
      ...value,
      [key]: {
        value: val ? null : { type: getVarKindType(type), value: null },
        auto: val ? 1 : 0,
      },
    })
  }
  const handleTypeChange = useCallback((variable: string, defaultValue: any) => {
    return (newType: VarKindType) => {
      const res = produce(value, (draft: ToolVarInputs) => {
        draft[variable].value = {
          type: newType,
          value: newType === VarKindType.variable ? '' : defaultValue,
        }
      })
      onChange(res)
    }
  }, [onChange, value])
  const handleValueChange = useCallback((variable: string, varType: FormTypeEnum) => {
    return (newValue: any) => {
      const res = produce(value, (draft: ToolVarInputs) => {
        draft[variable].value = {
          type: getVarKindType(varType),
          value: newValue,
        }
      })
      onChange(res)
    }
  }, [onChange, value])
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
  const handleVariableSelectorChange = useCallback((variable: string) => {
    return (newValue: ValueSelector | string) => {
      const res = produce(value, (draft: ToolVarInputs) => {
        draft[variable].value = {
          type: VarKindType.variable,
          value: newValue,
        }
      })
      onChange(res)
    }
  }, [onChange, value])

  const [isShowSchema, {
    setTrue: showSchema,
    setFalse: hideSchema,
  }] = useBoolean(false)

  const [schema, setSchema] = useState<SchemaRoot | null>(null)
  const [schemaRootName, setSchemaRootName] = useState<string>('')

  const renderField = (schema: any, showSchema: (schema: SchemaRoot, rootName: string) => void) => {
    const {
      default: defaultValue,
      variable,
      label,
      required,
      tooltip,
      type,
      scope,
      url,
      input_schema,
      placeholder,
      options,
    } = schema
    const auto = value[variable]?.auto
    const tooltipContent = (tooltip && (
      <Tooltip
        popupContent={<div className='w-[200px]'>
          {tooltip[language] || tooltip.en_US}
        </div>}
        triggerClassName='ml-0.5 w-4 h-4'
        asChild={false} />
    ))
    const varInput = value[variable].value
    const isString = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
    const isNumber = type === FormTypeEnum.textNumber
    const isObject = type === FormTypeEnum.object
    const isArray = type === FormTypeEnum.array
    const isShowJSONEditor = isObject || isArray
    const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
    const isBoolean = type === FormTypeEnum.boolean
    const isSelect = type === FormTypeEnum.select
    const isAppSelector = type === FormTypeEnum.appSelector
    const isModelSelector = type === FormTypeEnum.modelSelector
    const showTypeSwitch = isNumber || isObject || isArray
    const isConstant = varInput?.type === VarKindType.constant || !varInput?.type
    const showVariableSelector = isFile || varInput?.type === VarKindType.variable
    const targetVarType = () => {
      if (isString)
        return VarType.string
      else if (isNumber)
        return VarType.number
      else if (type === FormTypeEnum.files)
        return VarType.arrayFile
      else if (type === FormTypeEnum.file)
        return VarType.file
      else if (isBoolean)
        return VarType.boolean
      else if (isObject)
        return VarType.object
      else if (isArray)
        return VarType.arrayObject
      else
        return VarType.string
    }
    const getFilterVar = () => {
      if (isNumber)
        return (varPayload: any) => varPayload.type === VarType.number
      else if (isString)
        return (varPayload: any) => [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
      else if (isFile)
        return (varPayload: any) => [VarType.file, VarType.arrayFile].includes(varPayload.type)
      else if (isBoolean)
        return (varPayload: any) => varPayload.type === VarType.boolean
      else if (isObject)
        return (varPayload: any) => varPayload.type === VarType.object
      else if (isArray)
        return (varPayload: any) => [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varPayload.type)
      return undefined
    }

    return (
      <div key={variable} className='space-y-0.5'>
        <div className='system-sm-semibold flex items-center justify-between py-2 text-text-secondary'>
          <div className='flex items-center'>
            <span className={cn('code-sm-semibold max-w-[140px] truncate text-text-secondary')} title={label[language] || label.en_US}>{label[language] || label.en_US}</span>
            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
            <span className='system-xs-regular mx-1 text-text-quaternary'>·</span>
            <span className='system-xs-regular text-text-tertiary'>{targetVarType()}</span>
            {isShowJSONEditor && (
              <Tooltip
                popupContent={<div className='system-xs-medium text-text-secondary'>
                  {t('workflow.nodes.agent.clickToViewParameterSchema')}
                </div>}
                asChild={false}>
                  <div
                    className='ml-0.5 cursor-pointer rounded-[4px] p-px text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
                    onClick={() => showSchema(input_schema as SchemaRoot, label[language] || label.en_US)}
                  >
                    <RiBracesLine className='size-3.5'/>
                  </div>
              </Tooltip>
            )}

          </div>
          <div className='flex cursor-pointer items-center gap-1 rounded-[6px] border border-divider-subtle bg-background-default-lighter px-2 py-1 hover:bg-state-base-hover' onClick={() => handleAutomatic(variable, !auto, type)}>
            <span className='system-xs-medium text-text-secondary'>{t('plugin.detailPanel.toolSelector.auto')}</span>
            <Switch
              size='xs'
              defaultValue={!!auto}
              onChange={val => handleAutomatic(variable, val, type)}
            />
          </div>
        </div>
        {auto === 0 && (
          <div className={cn('gap-1', !(isShowJSONEditor && isConstant) && 'flex')}>
            {showTypeSwitch && (
              <FormInputTypeSwitch value={varInput?.type || VarKindType.constant} onChange={handleTypeChange(variable, defaultValue)}/>
            )}
            {isString && (
              <MixedVariableTextInput
                value={varInput?.value as string || ''}
                onChange={handleValueChange(variable, type)}
                nodesOutputVars={nodeOutputVars}
                availableNodes={availableNodes}
              />
            )}
            {isNumber && isConstant && (
              <Input
                className='h-8 grow'
                type='number'
                value={varInput?.value || ''}
                onChange={handleValueChange(variable, type)}
                placeholder={placeholder?.[language] || placeholder?.en_US}
              />
            )}
            {isBoolean && (
              <FormInputBoolean
                value={varInput?.value as boolean}
                onChange={handleValueChange(variable, type)}
              />
            )}
            {isSelect && (
              <SimpleSelect
                wrapperClassName='h-8 grow'
                defaultValue={varInput?.value}
                items={options.filter((option: { show_on: any[] }) => {
                  if (option.show_on.length)
                    return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

                  return true
                }).map((option: { value: any; label: { [x: string]: any; en_US: any } }) => ({ value: option.value, name: option.label[language] || option.label.en_US }))}
                onSelect={item => handleValueChange(variable, type)(item.value as string)}
                placeholder={placeholder?.[language] || placeholder?.en_US}
              />
            )}
            {isShowJSONEditor && isConstant && (
              <div className='mt-1 w-full'>
                <CodeEditor
                  title='JSON'
                  value={varInput?.value as any}
                  isExpand
                  isInNode
                  height={100}
                  language={CodeLanguage.json}
                  onChange={handleValueChange(variable, type)}
                  className='w-full'
                  placeholder={<div className='whitespace-pre'>{placeholder?.[language] || placeholder?.en_US}</div>}
                />
              </div>
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
                value={varInput}
                setModel={handleModelChange(variable)}
                scope={scope}
              />
            )}
            {showVariableSelector && (
              <VarReferencePicker
                zIndex={1001}
                className='h-8 grow'
                readonly={false}
                isShowNodeName
                nodeId={nodeId}
                value={varInput?.value || []}
                onChange={handleVariableSelectorChange(variable)}
                filterVar={getFilterVar()}
                schema={schema}
                valueTypePlaceHolder={targetVarType()}
              />
            )}
          </div>
        )}
        {url && (
          <a
            href={url}
            target='_blank' rel='noopener noreferrer'
            className='inline-flex items-center text-xs text-text-accent'
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
      {!isShowSchema && schemas.map(schema => renderField(schema, (s: SchemaRoot, rootName: string) => {
        setSchema(s)
        setSchemaRootName(rootName)
        showSchema()
      }))}
      {isShowSchema && (
        <SchemaModal
          isShow={isShowSchema}
          schema={schema!}
          rootName={schemaRootName}
          onClose={hideSchema}
        />
      )}
    </div>
  )
}

export default ReasoningConfigForm
