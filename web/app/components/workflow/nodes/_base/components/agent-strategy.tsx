import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
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
import Field from './field'
import type { ComponentProps } from 'react'

export type Strategy = {
  agent_strategy_provider_name: string
  agent_strategy_name: string
  agent_strategy_label: string
  agent_parameters?: ToolVarInputs
}

export type AgentStrategyProps = {
  strategy?: Strategy
  onStrategyChange: (strategy?: Strategy) => void
  formSchema: CredentialFormSchema[]
  formValue: ToolVarInputs
  onFormValueChange: (value: ToolVarInputs) => void
}

type CustomSchema<Type, Field = {}> = Omit<CredentialFormSchema, 'type'> & { type: Type } & Field

type MaxIterFormSchema = CustomSchema<'max-iter'>
type ToolSelectorSchema = CustomSchema<'tool-selector'>
type MultipleToolSelectorSchema = CustomSchema<'array[tools]'>

type CustomField = MaxIterFormSchema | ToolSelectorSchema | MultipleToolSelectorSchema

const devMockForm = [{
  name: 'model',
  label: {
    en_US: 'Model',
    zh_Hans: '模型',
    pt_BR: 'Model',
    ja_JP: 'Model',
  },
  placeholder: null,
  scope: 'tool-call&llm',
  auto_generate: null,
  template: null,
  required: true,
  default: null,
  min: null,
  max: null,
  options: [],
  type: 'model-selector',
},
{
  name: 'tools',
  label: {
    en_US: 'Tools list',
    zh_Hans: '工具列表',
    pt_BR: 'Tools list',
    ja_JP: 'Tools list',
  },
  placeholder: null,
  scope: null,
  auto_generate: null,
  template: null,
  required: true,
  default: null,
  min: null,
  max: null,
  options: [],
  type: 'array[tools]',
},
{
  name: 'instruction',
  label: {
    en_US: 'Instruction',
    zh_Hans: '指令',
    pt_BR: 'Instruction',
    ja_JP: 'Instruction',
  },
  placeholder: null,
  scope: null,
  auto_generate: {
    type: 'prompt_instruction',
  },
  template: {
    enabled: true,
  },
  required: true,
  default: null,
  min: null,
  max: null,
  options: [],
  type: 'string',
},
{
  name: 'query',
  label: {
    en_US: 'Query',
    zh_Hans: '查询',
    pt_BR: 'Query',
    ja_JP: 'Query',
  },
  placeholder: null,
  scope: null,
  auto_generate: null,
  template: null,
  required: true,
  default: null,
  min: null,
  max: null,
  options: [],
  type: 'string',
}]

export const AgentStrategy = (props: AgentStrategyProps) => {
  const { strategy, onStrategyChange, formSchema, formValue, onFormValueChange } = props
  const { t } = useTranslation()
  const renderField: ComponentProps<typeof Form<CustomField>>['customRenderField'] = (schema, props) => {
    switch (schema.type) {
      case 'max-iter': {
        const defaultValue = schema.default ? Number.parseInt(schema.default) : 1
        const value = props.value[schema.variable] || defaultValue
        const onChange = (value: number) => {
          props.onChange({ ...props.value, [schema.variable]: value })
        }
        return <Field title={t('workflow.nodes.agent.maxIterations')} tooltip={'max iter'} inline>
          <div className='flex w-[200px] items-center gap-3'>
            <Slider value={value} onChange={onChange} className='w-full' min={1} max={10} />
            <InputNumber
              value={value}
              // TODO: maybe empty, handle this
              onChange={onChange as any}
              defaultValue={defaultValue}
              size='sm'
              min={1}
              max={10}
              className='w-12'
              placeholder=''
            />
          </div>
        </Field>
      }
      case 'tool-selector': {
        const value = props.value[schema.variable]
        const onChange = (value: any) => {
          props.onChange({ ...props.value, [schema.variable]: value })
        }
        return (
          <Field title={'tool selector'} tooltip={'tool selector'}>
            <ToolSelector
              value={value}
              onSelect={item => onChange(item)}
            />
          </Field>
        )
      }
      case 'array[tools]': {
        return <Field title={'tool selector'} tooltip={'tool selector'}>
          multiple tool selector TODO
        </Field>
      }
    }
  }
  return <div className='space-y-2'>
    <AgentStrategySelector value={strategy} onChange={onStrategyChange} />
    {
      strategy
        ? <div>
          <Form<CustomField>
            formSchemas={[
              ...formSchema,
              ...devMockForm as any,
            ]}
            value={formValue}
            onChange={onFormValueChange}
            validating={false}
            showOnVariableMap={{}}
            isEditMode={true}
            isAgentStrategy={true}
            fieldLabelClassName='uppercase'
            customRenderField={renderField}
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
