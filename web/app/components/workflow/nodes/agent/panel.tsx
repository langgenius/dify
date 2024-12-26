import type { FC } from 'react'
import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import Field from '../_base/components/field'
import { InputNumber } from '@/app/components/base/input-number'
import Slider from '@/app/components/base/slider'
import { AgentStrategy } from '../_base/components/agent-strategy'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'

const AgentPanel: FC<NodePanelProps<AgentNodeType>> = (props) => {
  const { inputs, setInputs, currentStrategy } = useConfig(props.id, props.data)
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
          agent_strategy_label: inputs.agent_strategy_label!,
        } : undefined}
        onStrategyChange={(strategy) => {
          setInputs({
            ...inputs,
            agent_strategy_provider_name: strategy?.agent_strategy_provider_name,
            agent_strategy_name: strategy?.agent_strategy_name,
            agent_parameters: strategy?.agent_parameters,
            agent_strategy_label: strategy?.agent_strategy_label,
          })
        }}
        formSchema={currentStrategy?.parameters as any || []}
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
