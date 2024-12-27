import type { CredentialFormSchemaNumberInput } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { type CredentialFormSchema, FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
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
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'

export type Strategy = {
  agent_strategy_provider_name: string
  agent_strategy_name: string
  agent_strategy_label: string
  agent_parameters?: ToolVarInputs
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

type CustomField = ToolSelectorSchema | MultipleToolSelectorSchema

const devMockForm = [{
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
},
{
  name: 'max iterations',
  label: {
    en_US: 'Max Iterations',
    zh_Hans: '最大迭代次数',
    pt_BR: 'Max Iterations',
    ja_JP: 'Max Iterations',
  },
  placeholder: null,
  scope: null,
  auto_generate: null,
  template: null,
  required: true,
  default: '1',
  min: 1,
  max: 10,
  type: FormTypeEnum.textNumber,
  tooltip: {
    en_US: 'The maximum number of iterations to run',
    zh_Hans: '运行的最大迭代次数',
    pt_BR: 'The maximum number of iterations to run',
    ja_JP: 'The maximum number of iterations to run',
  },
}]

export const AgentStrategy = (props: AgentStrategyProps) => {
  const { strategy, onStrategyChange, formSchema, formValue, onFormValueChange } = props
  const { t } = useTranslation()
  const language = useLanguage()
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
