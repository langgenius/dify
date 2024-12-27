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
              {
                type: 'max-iter',
                variable: 'max_iterations',
                label: {
                  en_US: 'Max Iterations',
                  zh_Hans: '最大迭代次数',
                },
                name: 'max iter',
                required: true,
                show_on: [],
                default: '3',
              } as MaxIterFormSchema,
            ]}
            value={formValue}
            onChange={onFormValueChange}
            validating={false}
            showOnVariableMap={{}}
            isEditMode={true}
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
