import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolVarInputs } from '../../tool/types'
import ListEmpty from '@/app/components/base/list-empty'
import { AgentStrategySelector } from './agent-strategy-selector'
import Link from 'next/link'

export type Strategy = {
  agent_strategy_provider_name: string
  agent_strategy_name: string
  agent_strategy_label?: string
  agent_parameters?: ToolVarInputs
}

export type AgentStrategyProps = {
  strategy?: Strategy
  onStrategyChange: (strategy?: Strategy) => void
  formSchema: CredentialFormSchema[]
  formValue: ToolVarInputs
  onFormValueChange: (value: ToolVarInputs) => void
}

export const AgentStrategy = (props: AgentStrategyProps) => {
  const { strategy, onStrategyChange, formSchema, formValue, onFormValueChange } = props
  return <div className='space-y-2'>
    <AgentStrategySelector value={strategy} onChange={onStrategyChange} />
    {
      strategy
        ? <div></div>
        // TODO: list empty need a icon
        : <ListEmpty
          title='Please configure agentic strategy.'
          description={<div className='text-text-tertiary text-xs'>
            After configuring the agentic strategy, this node will automatically load the remaining configurations. The strategy will affect the mechanism of multi-step tool reasoning. <br />
            <Link href={'/'} className='text-text-accent-secondary'>Learn more</Link>
          </div>}
        />
    }
  </div>
}
