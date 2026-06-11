import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useHooksStore } from '../../hooks-store/store'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'
import { defaultDeclaredOutputs, getRosterAgentFromComposer, outputToVarItem } from './helpers'

export function AgentPanel({
  id,
  data,
}: NodePanelProps<AgentNodeType>) {
  const { t } = useTranslation()
  const { inputs, setInputs } = useNodeCrud<AgentNodeType>(id, data)
  const appId = useHooksStore(s => s.configsMap?.flowId)
  const composerQuery = useQuery({
    ...consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryOptions({
      input: appId
        ? {
            params: {
              app_id: appId,
              node_id: id,
            },
          }
        : skipToken,
    }),
  })
  const outputVars = (composerQuery.data?.effective_declared_outputs?.length
    ? composerQuery.data.effective_declared_outputs
    : defaultDeclaredOutputs).map(output => outputToVarItem(output, t))
  const rosterAgent = getRosterAgentFromComposer(composerQuery.data, inputs.agent_roster)

  const handleTaskChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_task = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return (
    <div className="pt-2">
      {rosterAgent && (
        <div className="border-b border-divider-subtle">
          <AgentRosterField agent={rosterAgent} />
        </div>
      )}
      <div className="border-b border-divider-subtle">
        <AgentTaskField
          id={id}
          data={inputs}
          onChange={handleTaskChange}
        />
      </div>
      <AgentAdvancedSettings />
      <div>
        <OutputVars>
          {outputVars.map(output => (
            <VarItem
              key={output.name}
              name={output.name}
              type={output.type}
              description={output.description}
            />
          ))}
        </OutputVars>
      </div>
    </div>
  )
}
