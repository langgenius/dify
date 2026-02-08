import type { ComponentProps } from 'react'
import type { Node } from 'reactflow'
import type { NodeOutPutVar } from '../../../types'
import type { ToolVarInputs } from '../../tool/types'
import type { CredentialFormSchema, CredentialFormSchemaNumberInput, CredentialFormSchemaTextInput } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { PluginMeta } from '@/app/components/plugins/types'
import { noop } from 'es-toolkit/function'
import Link from 'next/link'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'
import { InputNumber } from '@/app/components/base/input-number'
import ListEmpty from '@/app/components/base/list-empty'
import Slider from '@/app/components/base/slider'
import { FormTypeEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import MultipleToolSelector from '@/app/components/plugins/plugin-detail-panel/multiple-tool-selector'
import ToolSelector from '@/app/components/plugins/plugin-detail-panel/tool-selector'
import { useDocLink } from '@/context/i18n'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { AppModeEnum } from '@/types/app'
import { useWorkflowStore } from '../../../store'
import { AgentStrategySelector } from './agent-strategy-selector'
import Field from './field'
import Editor from './prompt/editor'

export type Strategy = {
  agent_strategy_provider_name: string
  agent_strategy_name: string
  agent_strategy_label: string
  agent_output_schema: Record<string, any>
  plugin_unique_identifier: string
  meta?: PluginMeta
}

export type AgentStrategyProps = {
  strategy?: Strategy
  onStrategyChange: (strategy?: Strategy) => void
  formSchema: CredentialFormSchema[]
  formValue: ToolVarInputs
  onFormValueChange: (value: ToolVarInputs) => void
  nodeOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  nodeId?: string
}

type CustomSchema<Type, Field = {}> = Omit<CredentialFormSchema, 'type'> & { type: Type } & Field

type ToolSelectorSchema = CustomSchema<'tool-selector'>
type MultipleToolSelectorSchema = CustomSchema<'array[tools]'>

type CustomField = ToolSelectorSchema | MultipleToolSelectorSchema

export const AgentStrategy = memo((props: AgentStrategyProps) => {
  const { strategy, onStrategyChange, formSchema, formValue, onFormValueChange, nodeOutputVars, availableNodes, nodeId } = props
  const { t } = useTranslation()
  const docLink = useDocLink()
  const defaultModel = useDefaultModel(ModelTypeEnum.textGeneration)
  const renderI18nObject = useRenderI18nObject()
  const workflowStore = useWorkflowStore()
  const {
    setControlPromptEditorRerenderKey,
  } = workflowStore.getState()

  const override: ComponentProps<typeof Form<CustomField>>['override'] = [
    [FormTypeEnum.textNumber, FormTypeEnum.textInput],
    (schema, props) => {
      switch (schema.type) {
        case FormTypeEnum.textInput: {
          const def = schema as CredentialFormSchemaTextInput
          const value = props.value[schema.variable] || schema.default
          const instanceId = schema.variable
          const onChange = (value: string) => {
            props.onChange({ ...props.value, [schema.variable]: value })
          }
          const handleGenerated = (value: string) => {
            onChange(value)
            setControlPromptEditorRerenderKey(Math.random())
          }
          return (
            <Editor
              value={value}
              onChange={onChange}
              onGenerated={handleGenerated}
              instanceId={instanceId}
              key={instanceId}
              title={renderI18nObject(schema.label)}
              headerClassName="bg-transparent px-0 text-text-secondary system-sm-semibold-uppercase"
              containerBackgroundClassName="bg-transparent"
              gradientBorder={false}
              nodeId={nodeId}
              isSupportPromptGenerator={!!def.auto_generate?.type}
              titleTooltip={schema.tooltip && renderI18nObject(schema.tooltip)}
              editorContainerClassName="px-0 bg-components-input-bg-normal focus-within:bg-components-input-bg-active rounded-lg"
              availableNodes={availableNodes}
              nodesOutputVars={nodeOutputVars}
              isSupportJinja={def.template?.enabled}
              required={def.required}
              varList={[]}
              modelConfig={
                defaultModel.data
                  ? {
                      mode: AppModeEnum.CHAT,
                      name: defaultModel.data.model,
                      provider: defaultModel.data.provider.provider,
                      completion_params: {},
                    }
                  : undefined
              }
              placeholderClassName="px-2 py-1"
              titleClassName="system-sm-semibold-uppercase text-text-secondary text-[13px]"
              inputClassName="px-2 py-1"
            />
          )
        }
        case FormTypeEnum.textNumber: {
          const def = schema as CredentialFormSchemaNumberInput
          if (!def.max || !def.min)
            return false

          const defaultValue = schema.default ? Number.parseInt(schema.default) : 1
          const value = props.value[schema.variable] || defaultValue
          const onChange = (value: number) => {
            props.onChange({ ...props.value, [schema.variable]: value })
          }
          return (
            <Field
              title={(
                <>
                  {renderI18nObject(def.label)}
                  {' '}
                  {def.required && <span className="text-red-500">*</span>}
                </>
              )}
              key={def.variable}
              tooltip={def.tooltip && renderI18nObject(def.tooltip)}
              inline
            >
              <div className="flex w-[200px] items-center gap-3">
                <Slider
                  value={value}
                  onChange={onChange}
                  className="w-full"
                  min={def.min}
                  max={def.max}
                />
                <InputNumber
                  value={value}
                  // TODO: maybe empty, handle this
                  onChange={onChange as any}
                  defaultValue={defaultValue}
                  size="regular"
                  min={def.min}
                  max={def.max}
                  className="w-12"
                />
              </div>
            </Field>
          )
        }
      }
    },
  ]
  const renderField: ComponentProps<typeof Form<CustomField>>['customRenderField'] = (schema, props) => {
    switch (schema.type) {
      case FormTypeEnum.toolSelector: {
        const value = props.value[schema.variable]
        const onChange = (value: any) => {
          props.onChange({ ...props.value, [schema.variable]: value })
        }
        return (
          <Field
            title={(
              <>
                {renderI18nObject(schema.label)}
                {' '}
                {schema.required && <span className="text-red-500">*</span>}
              </>
            )}
            tooltip={schema.tooltip && renderI18nObject(schema.tooltip)}
          >
            <ToolSelector
              nodeId={props.nodeId || ''}
              nodeOutputVars={props.nodeOutputVars || []}
              availableNodes={props.availableNodes || []}
              scope={schema.scope}
              value={value}
              onSelect={item => onChange(item)}
              onDelete={() => onChange(null)}
              onSelectMultiple={noop}
            />
          </Field>
        )
      }
      case FormTypeEnum.multiToolSelector: {
        const value = props.value[schema.variable]
        const onChange = (value: any) => {
          props.onChange({ ...props.value, [schema.variable]: value })
        }
        return (
          <MultipleToolSelector
            nodeId={props.nodeId || ''}
            nodeOutputVars={props.nodeOutputVars || []}
            availableNodes={props.availableNodes || []}
            scope={schema.scope}
            value={value || []}
            label={renderI18nObject(schema.label)}
            tooltip={schema.tooltip && renderI18nObject(schema.tooltip)}
            onChange={onChange}
            supportCollapse
            required={schema.required}
          />
        )
      }
    }
  }
  return (
    <div className="space-y-2">
      <AgentStrategySelector value={strategy} onChange={onStrategyChange} />
      {
        strategy
          ? (
              <div>
                <Form<CustomField>
                  formSchemas={[
                    ...formSchema,
                  ]}
                  value={formValue}
                  onChange={onFormValueChange}
                  validating={false}
                  showOnVariableMap={{}}
                  isEditMode={true}
                  isAgentStrategy={true}
                  fieldLabelClassName="uppercase"
                  customRenderField={renderField}
                  override={override}
                  nodeId={nodeId}
                  nodeOutputVars={nodeOutputVars || []}
                  availableNodes={availableNodes || []}
                />
              </div>
            )
          : (
              <ListEmpty
                icon={<Agent className="h-5 w-5 shrink-0 text-text-accent" />}
                title={t('nodes.agent.strategy.configureTip', { ns: 'workflow' })}
                description={(
                  <div className="text-xs text-text-tertiary">
                    {t('nodes.agent.strategy.configureTipDesc', { ns: 'workflow' })}
                    {' '}
                    <br />
                    <Link
                      href={docLink('/use-dify/nodes/agent')}
                      className="text-text-accent-secondary"
                      target="_blank"
                    >
                      {t('nodes.agent.learnMore', { ns: 'workflow' })}
                    </Link>
                  </div>
                )}
              />
            )
      }
    </div>
  )
})

AgentStrategy.displayName = 'AgentStrategy'
