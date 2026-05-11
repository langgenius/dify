import type { Node } from 'reactflow'
import type { ReasoningConfigValue as ReasoningConfigValueShape } from './reasoning-config-form.helpers'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import type {
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiArrowRightUpLine,
  RiBracesLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { AppSelector } from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import FormInputBoolean from '@/app/components/workflow/nodes/_base/components/form-input-boolean'
import FormInputTypeSwitch from '@/app/components/workflow/nodes/_base/components/form-input-type-switch'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import MixedVariableTextInput from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import {
  createPickerProps,
  getFieldFlags,
  getFieldTitle,
  mergeReasoningValue,
  resolveTargetVarType,
  updateInputAutoState,
  updateReasoningValue,
  updateVariableSelectorValue,
  updateVariableTypeValue,
} from './reasoning-config-form.helpers'
import SchemaModal from './schema-modal'

export type ReasoningConfigValue = ReasoningConfigValueShape

type Props = {
  value: ReasoningConfigValue
  onChange: (val: ReasoningConfigValue) => void
  schemas: ToolFormSchema[]
  nodeOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
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

  const handleAutomatic = (key: string, val: boolean, type: string) => {
    onChange(updateInputAutoState(value, key, val, type))
  }

  const handleTypeChange = useCallback((variable: string, defaultValue: unknown) => {
    return (newType: VarKindType) => {
      onChange(updateVariableTypeValue(value, variable, newType, defaultValue))
    }
  }, [onChange, value])

  const handleValueChange = useCallback((variable: string, varType: string) => {
    return (newValue: unknown) => {
      onChange(updateReasoningValue(value, variable, varType, newValue))
    }
  }, [onChange, value])

  const handleAppChange = useCallback((variable: string) => {
    return (app: {
      app_id: string
      inputs: Record<string, unknown>
      files?: unknown[]
    }) => {
      onChange(updateReasoningValue(value, variable, FormTypeEnum.appSelector, app))
    }
  }, [onChange, value])

  const handleModelChange = useCallback((variable: string) => {
    return (model: Record<string, unknown>) => {
      onChange(mergeReasoningValue(value, variable, model))
    }
  }, [onChange, value])

  const handleVariableSelectorChange = useCallback((variable: string) => {
    return (newValue: ValueSelector | string) => {
      onChange(updateVariableSelectorValue(value, variable, newValue))
    }
  }, [onChange, value])

  const [isShowSchema, {
    setTrue: showSchema,
    setFalse: hideSchema,
  }] = useBoolean(false)

  const [schema, setSchema] = useState<SchemaRoot | null>(null)
  const [schemaRootName, setSchemaRootName] = useState<string>('')

  const renderField = (schema: ToolFormSchema, showSchema: (schema: SchemaRoot, rootName: string) => void) => {
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
    const fieldTitle = getFieldTitle(label, language)
    const tooltipText = tooltip?.[language] || tooltip?.en_US
    const tooltipContent = tooltipText && (
      <Infotip
        aria-label={tooltipText}
        className="ml-0.5 h-4 w-4"
        popupClassName="w-[200px]"
      >
        {tooltipText}
      </Infotip>
    )
    const varInput = value[variable]!.value
    const {
      isString,
      isNumber,
      isShowJSONEditor,
      isBoolean,
      isSelect,
      isAppSelector,
      isModelSelector,
      showTypeSwitch,
      isConstant,
      showVariableSelector,
    } = getFieldFlags(type, varInput)
    const pickerProps = createPickerProps({
      type,
      value,
      language,
      schema,
    })
    const selectedOption = isSelect && options
      ? pickerProps.selectItems.find(item => item.value === (varInput?.value as string | number | undefined)) ?? null
      : null

    return (
      <div key={variable} className="space-y-0.5">
        <div className="flex items-center justify-between py-2 system-sm-semibold text-text-secondary">
          <div className="flex items-center">
            <span className={cn('max-w-[140px] truncate code-sm-semibold text-text-secondary')} title={fieldTitle}>{fieldTitle}</span>
            {required && (
              <span className="ml-1 text-red-500">*</span>
            )}
            {tooltipContent}
            <span className="mx-1 system-xs-regular text-text-quaternary">·</span>
            <span className="system-xs-regular text-text-tertiary">{resolveTargetVarType(type)}</span>
            {isShowJSONEditor && (
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <button
                      type="button"
                      aria-label={t('nodes.agent.clickToViewParameterSchema', { ns: 'workflow' })}
                      className="ml-0.5 cursor-pointer rounded-sm border-0 bg-transparent p-px text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                      onClick={() => showSchema(input_schema as SchemaRoot, fieldTitle!)}
                    >
                      <RiBracesLine className="size-3.5" />
                    </button>
                  )}
                />
                <TooltipContent className="system-xs-medium text-text-secondary">
                  {t('nodes.agent.clickToViewParameterSchema', { ns: 'workflow' })}
                </TooltipContent>
              </Tooltip>
            )}

          </div>
          <div className="flex cursor-pointer items-center gap-1 rounded-md border border-divider-subtle bg-background-default-lighter px-2 py-1 hover:bg-state-base-hover" onClick={() => handleAutomatic(variable, !auto, type)}>
            <span className="system-xs-medium text-text-secondary">{t('detailPanel.toolSelector.auto', { ns: 'plugin' })}</span>
            <Switch
              size="xs"
              checked={!!auto}
              onCheckedChange={val => handleAutomatic(variable, val, type)}
            />
          </div>
        </div>
        {auto === 0 && (
          <div className={cn('gap-1', !(isShowJSONEditor && isConstant) && 'flex')}>
            {showTypeSwitch && (
              <FormInputTypeSwitch value={varInput?.type || VarKindType.constant} onChange={handleTypeChange(variable, defaultValue)} />
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
                className="h-8 grow"
                type="number"
                value={(varInput?.value as string | number) || ''}
                onChange={e => handleValueChange(variable, type)(e.target.value)}
                placeholder={placeholder?.[language] || placeholder?.en_US}
              />
            )}
            {isBoolean && (
              <FormInputBoolean
                value={varInput?.value as boolean}
                onChange={handleValueChange(variable, type)}
              />
            )}
            {isSelect && options && (
              <Select value={selectedOption ? String(selectedOption.value) : null} onValueChange={value => value && handleValueChange(variable, type)(value)}>
                <SelectTrigger className="h-8 grow">
                  {selectedOption?.name ?? placeholder?.[language] ?? placeholder?.en_US}
                </SelectTrigger>
                <SelectContent>
                  {pickerProps.selectItems.map(item => (
                    <SelectItem key={item.value} value={String(item.value)}>
                      <SelectItemText>{item.name}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isShowJSONEditor && isConstant && (
              <div className="mt-1 w-full">
                <CodeEditor
                  title="JSON"
                  value={varInput?.value as string}
                  isExpand
                  isInNode
                  height={100}
                  language={CodeLanguage.json}
                  onChange={handleValueChange(variable, type)}
                  className="w-full"
                  placeholder={<div className="whitespace-pre">{placeholder?.[language] || placeholder?.en_US}</div>}
                />
              </div>
            )}
            {isAppSelector && (
              <AppSelector
                disabled={false}
                scope={scope || 'all'}
                value={varInput as { app_id: string, inputs: Record<string, unknown>, files?: unknown[] } | undefined}
                onSelect={handleAppChange(variable)}
              />
            )}
            {isModelSelector && (
              <ModelParameterModal
                popupClassName="w-[387px]!"
                isAdvancedMode
                isInWorkflow
                value={varInput}
                setModel={handleModelChange(variable)}
                scope={scope}
              />
            )}
            {showVariableSelector && (
              <VarReferencePicker
                className="h-8 grow"
                readonly={false}
                isShowNodeName
                nodeId={nodeId}
                value={(varInput?.value as string | ValueSelector) || []}
                onChange={handleVariableSelectorChange(variable)}
                filterVar={pickerProps.filterVar}
                schema={pickerProps.schema}
                valueTypePlaceHolder={pickerProps.targetVarType}
              />
            )}
          </div>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-xs text-text-accent"
          >
            {t('howToGet', { ns: 'tools' })}
            <RiArrowRightUpLine className="ml-1 h-3 w-3" />
          </a>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-3 px-4 py-2">
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
