import type { CredentialFormSchemaNumberInput } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { type CredentialFormSchema, FormTypeEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolVarInputs } from '../../tool/types'
import ListEmpty from '@/app/components/base/list-empty'
import { AgentStrategySelector } from './agent-strategy-selector'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'
import { InputNumber } from '@/app/components/base/input-number'
import Slider from '@/app/components/base/slider'
import ToolSelector from '@/app/components/plugins/plugin-detail-panel/tool-selector'
import MultipleToolSelector from '@/app/components/plugins/plugin-detail-panel/multiple-tool-selector'
import Field from './field'
import type { ComponentProps } from 'react'
import { useDefaultModel, useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Editor from './prompt/editor'
import { useWorkflowStore } from '../../../store'

export type Strategy = {
  agent_strategy_provider_name: string
  agent_strategy_name: string
  agent_strategy_label: string
  agent_output_schema: Record<string, any>
}

export type AgentStrategyProps = {
  strategy?: Strategy
  onStrategyChange: (strategy?: Strategy) => void
  formSchema: CredentialFormSchema[]
  formValue: ToolVarInputs
  onFormValueChange: (value: ToolVarInputs) => void
}

type CustomSchema<Type, Field = {}> = Omit<CredentialFormSchema, 'type'> & { type: Type } & Field

type ToolSelectorSchema = CustomSchema<'tool-selector'>
type MultipleToolSelectorSchema = CustomSchema<'array[tools]'>
type StringSchema = CustomSchema<'string', {
  template?: {
    enabled: boolean
  },
  auto_generate?: {
    type: string
  }
}>

type CustomField = ToolSelectorSchema | MultipleToolSelectorSchema | StringSchema

export const AgentStrategy = (props: AgentStrategyProps) => {
  const { strategy, onStrategyChange, formSchema, formValue, onFormValueChange } = props
  const { t } = useTranslation()
  const language = useLanguage()
  const defaultModel = useDefaultModel(ModelTypeEnum.textGeneration)
  const workflowStore = useWorkflowStore()
  const {
    setControlPromptEditorRerenderKey,
  } = workflowStore.getState()
  const override: ComponentProps<typeof Form<CustomField>>['override'] = [
    [FormTypeEnum.textNumber],
    (schema, props) => {
      switch (schema.type) {
        case FormTypeEnum.textNumber: {
          const def = schema as CredentialFormSchemaNumberInput
          if (!def.max || !def.min)
            return false

          const defaultValue = schema.default ? Number.parseInt(schema.default) : 1
          const value = props.value[schema.variable] || defaultValue
          const onChange = (value: number) => {
            props.onChange({ ...props.value, [schema.variable]: value })
          }
          return <Field title={def.label[language]} tooltip={def.tooltip?.[language]} inline>
            <div className='flex w-[200px] items-center gap-3'>
              <Slider
                value={value}
                onChange={onChange}
                className='w-full'
                min={def.min}
                max={def.max}
              />
              <InputNumber
                value={value}
                // TODO: maybe empty, handle this
                onChange={onChange as any}
                defaultValue={defaultValue}
                size='sm'
                min={def.min}
                max={def.max}
                className='w-12'
              />
            </div>
          </Field>
        }
      }
    },
  ]
  const renderField: ComponentProps<typeof Form<CustomField>>['customRenderField'] = (schema, props) => {
    switch (schema.type) {
      case 'tool-selector': {
        const value = props.value[schema.variable]
        const onChange = (value: any) => {
          props.onChange({ ...props.value, [schema.variable]: value })
        }
        return (
          <Field title={schema.label[language]} tooltip={schema.tooltip?.[language]}>
            <ToolSelector
              scope={schema.scope}
              value={value}
              onSelect={item => onChange(item)}
              onDelete={() => onChange(null)}
            />
          </Field>
        )
      }
      case 'array[tools]': {
        const value = props.value[schema.variable]
        const onChange = (value: any) => {
          props.onChange({ ...props.value, [schema.variable]: value })
        }
        return (
          <MultipleToolSelector
            scope={schema.scope}
            value={value || []}
            label={schema.label[language]}
            tooltip={schema.tooltip?.[language]}
            onChange={onChange}
            supportCollapse
          />
        )
      }
      case 'string': {
        const value = props.value[schema.variable]
        const onChange = (value: string) => {
          props.onChange({ ...props.value, [schema.variable]: value })
        }
        const handleGenerated = (value: string) => {
          onChange(value)
          setControlPromptEditorRerenderKey(Math.random())
        }
        return <Editor
          value={value}
          onChange={onChange}
          onGenerated={handleGenerated}
          title={schema.label[language]}
          headerClassName='bg-transparent px-0 text-text-secondary system-sm-semibold-uppercase'
          containerClassName='bg-transparent'
          gradientBorder={false}
          isSupportPromptGenerator={!!schema.auto_generate?.type}
          titleTooltip={schema.tooltip?.[language]}
          editorContainerClassName='px-0'
          isSupportJinja={schema.template?.enabled}
          varList={[]}
          modelConfig={
            defaultModel.data
              ? {
                mode: 'chat',
                name: defaultModel.data.model,
                provider: defaultModel.data.provider.provider,
                completion_params: {},
              } : undefined
          }
          placeholderClassName='px-2 py-1'
          titleClassName='system-sm-semibold-uppercase text-text-secondary text-[13px]'
          inputClassName='px-2 py-1 bg-components-input-bg-normal focus:bg-components-input-bg-active focus:border-components-input-border-active focus:border rounded-lg'
        />
      }
    }
  }
  return <div className='space-y-2'>
    <AgentStrategySelector value={strategy} onChange={onStrategyChange} />
    {
      strategy
        ? <div>
          <Form<CustomField>
            formSchemas={formSchema}
            value={formValue}
            onChange={onFormValueChange}
            validating={false}
            showOnVariableMap={{}}
            isEditMode={true}
            isAgentStrategy={true}
            fieldLabelClassName='uppercase'
            customRenderField={renderField}
            override={override}
          />
        </div>
        : <ListEmpty
          icon={<Agent className='w-5 h-5 shrink-0 text-text-accent' />}
          title={t('workflow.nodes.agent.strategy.configureTip')}
          description={<div className='text-text-tertiary text-xs'>
            {t('workflow.nodes.agent.strategy.configureTipDesc')} <br />
            <Link href={'/'} className='text-text-accent-secondary'>
              {t('workflow.nodes.agent.learnMore')}
            </Link>
          </div>}
        />
    }
  </div>
}
