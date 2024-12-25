import type { FC } from 'react'
import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import Field from '../_base/components/field'
import { InputNumber } from '@/app/components/base/input-number'
import Slider from '@/app/components/base/slider'
import { AgentStrategy } from '../_base/components/agent-strategy'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'
import { type CredentialFormSchema, FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

// @ts-expect-error fuck
const mockSchema = [
  {
    name: 'format',
    label: {
      en_US: 'Format',
      zh_Hans: '格式',
      pt_BR: 'Format',
      ja_JP: 'Format',
    },
    placeholder: undefined,
    scope: undefined,
    required: false,
    default: '%Y-%m-%d %H:%M:%S',
    options: [],
    type: 'text-input',
    form: 'form',
    llm_description: null,
    variable: 'format',
    _type: 'string',
    show_on: [],
    tooltip: {
      en_US: 'Time format in strftime standard.',
      zh_Hans: 'strftime 标准的时间格式。',
    },
  },
  {
    name: 'model',
    type: FormTypeEnum.modelSelector,
    label: {
      en_US: 'Model',
      zh_Hans: '模型',
    },
    scope: 'all',
  },
] as Array<CredentialFormSchema & { name: string }>

const AgentPanel: FC<NodePanelProps<AgentNodeType>> = (props) => {
  const { inputs, setInputs } = useConfig(props.id, props.data)
  const { t } = useTranslation()
  const [iter, setIter] = [inputs.max_iterations, (value: number) => {
    setInputs({
      ...inputs,
      max_iterations: value,
    })
  }]
  return <div className='space-y-2 my-2'>
    <Field title={t('workflow.nodes.agent.strategy.label')} className='px-4' >
      <AgentStrategy
        strategy={inputs.agent_strategy_name ? {
          agent_strategy_provider_name: inputs.agent_strategy_provider_name!,
          agent_strategy_name: inputs.agent_strategy_name!,
          agent_parameters: inputs.agent_parameters,
        } : undefined}
        onStrategyChange={(strategy) => {
          setInputs({
            ...inputs,
            agent_strategy_provider_name: strategy?.agent_strategy_provider_name,
            agent_strategy_name: strategy?.agent_strategy_name,
            agent_parameters: strategy?.agent_parameters,
          })
        }}
        formSchema={mockSchema as any}
        formValue={inputs.agent_parameters || {}}
        onFormValueChange={value => setInputs({
          ...inputs,
          agent_parameters: value,
        })}
      />
    </Field>
    <Field title={t('workflow.nodes.agent.tools')} className='px-4'>

    </Field>
    <Field title={t('workflow.nodes.agent.maxIterations')} tooltip={'max iter'} inline className='px-4'>
      <div className='flex w-[200px] items-center gap-3'>
        <Slider value={iter} onChange={setIter} className='w-full' min={1} max={10} />
        <InputNumber
          value={iter}
          // TODO: maybe empty, handle this
          onChange={setIter as any}
          defaultValue={3}
          size='sm'
          min={1}
          max={10}
          className='w-12'
          placeholder=''
        />
      </div>
    </Field>
  </div>
}

export default AgentPanel
