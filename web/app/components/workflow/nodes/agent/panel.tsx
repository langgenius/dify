import type { FC } from 'react'
import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import Field from '../_base/components/field'
import { AgentStrategy } from '../_base/components/agent-strategy'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'
import OutputVars, { VarItem } from '../_base/components/output-vars'

const i18nPrefix = 'workflow.nodes.agent'

const AgentPanel: FC<NodePanelProps<AgentNodeType>> = (props) => {
  const { inputs, setInputs, currentStrategy } = useConfig(props.id, props.data)
  const { t } = useTranslation()
  return <div className='my-2'>
    <Field title={t('workflow.nodes.agent.strategy.label')} className='px-4' >
      <AgentStrategy
        strategy={inputs.agent_strategy_name ? {
          agent_strategy_provider_name: inputs.agent_strategy_provider_name!,
          agent_strategy_name: inputs.agent_strategy_name!,
          agent_parameters: inputs.agent_parameters,
          agent_strategy_label: inputs.agent_strategy_label!,
          agent_output_schema: inputs.output_schema,
        } : undefined}
        onStrategyChange={(strategy) => {
          setInputs({
            ...inputs,
            agent_strategy_provider_name: strategy?.agent_strategy_provider_name,
            agent_strategy_name: strategy?.agent_strategy_name,
            agent_parameters: strategy?.agent_parameters,
            agent_strategy_label: strategy?.agent_strategy_label,
            output_schema: strategy!.agent_output_schema,
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
    <div>
      <OutputVars>
        <VarItem
          name='text'
          type='String'
          description={t(`${i18nPrefix}.outputVars.text`)}
        />
        <VarItem
          name='files'
          type='Array[File]'
          description={t(`${i18nPrefix}.outputVars.files.title`)}
        />
        <VarItem
          name='json'
          type='Array[Object]'
          description={t(`${i18nPrefix}.outputVars.json`)}
        />
        {inputs.output_schema && Object.entries(inputs.output_schema).map(([name, schema]) => (
          <VarItem
            key={name}
            name={name}
            type={schema.type}
            description={schema.description}
          />
        ))}
      </OutputVars>
    </div>
  </div>
}

export default AgentPanel
