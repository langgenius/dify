import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolVarInputs } from '../../tool/types'
import ListEmpty from '@/app/components/base/list-empty'
import { AgentStrategySelector } from './agent-strategy-selector'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import InputVarList from '../../tool/components/input-var-list'

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
  /**
   * @description use for get available vars
   */
  nodeId: string
}

export const AgentStrategy = (props: AgentStrategyProps) => {
  const { strategy, onStrategyChange, formSchema, formValue, onFormValueChange, nodeId } = props
  const { t } = useTranslation()
  return <div className='space-y-2'>
    <AgentStrategySelector value={strategy} onChange={onStrategyChange} />
    {
      strategy
        ? <div>
          <InputVarList
            readOnly={false}
            nodeId={nodeId}
            schema={formSchema}
            value={formValue}
            onChange={onFormValueChange}
          />
        </div>
        // TODO: list empty need a icon
        : <ListEmpty
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
