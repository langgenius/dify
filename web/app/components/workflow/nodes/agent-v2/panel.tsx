import type { AgentRosterNodeData } from '../../block-selector/types'
import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'
import { useAgentRosterDetail } from './hooks'
import { getAgentV2DeclaredOutputs, getDeclaredOutputTypeLabel } from './output-variables'

const i18nPrefix = 'nodes.agent'

function getOutputDescription(
  output: ReturnType<typeof getAgentV2DeclaredOutputs>[number],
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (output.name === 'text')
    return t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })

  if (output.name === 'files')
    return t(`${i18nPrefix}.outputVars.files.title`, { ns: 'workflow' })

  if (output.name === 'json')
    return t(`${i18nPrefix}.outputVars.json`, { ns: 'workflow' })

  return output.description || ''
}

export function AgentV2Panel({
  id,
  data,
}: NodePanelProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const { inputs, setInputs } = useNodeCrud<AgentV2NodeType>(id, data)
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const drawerPortalContainerRef = useRef<HTMLDivElement>(null)
  const declaredOutputs = getAgentV2DeclaredOutputs(inputs)
  const rosterAgentId = inputs.agent_binding?.binding_type === 'roster_agent' ? inputs.agent_binding.agent_id : undefined
  const rosterAgentQuery = useAgentRosterDetail(rosterAgentId)

  const handleTaskChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_task = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRosterChange = useCallback((agent: AgentRosterNodeData) => {
    const newInputs = produce(inputs, (draft) => {
      delete (draft as AgentV2NodeType & { agent_roster?: unknown }).agent_roster
      draft.agent_binding = {
        binding_type: 'roster_agent',
        agent_id: agent.id,
      }
    })
    handleNodeDataUpdateWithSyncDraft(
      {
        id,
        data: newInputs,
      },
      {
        sync: true,
        notRefreshWhenSyncError: true,
      },
    )
  }, [handleNodeDataUpdateWithSyncDraft, id, inputs])

  return (
    <div ref={drawerPortalContainerRef} className="pt-2">
      <div className="border-b border-divider-subtle">
        <AgentRosterField
          agent={rosterAgentQuery.data}
          agentId={rosterAgentId}
          portalContainerRef={drawerPortalContainerRef}
          onChange={handleRosterChange}
        />
      </div>
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
          {declaredOutputs.map(output => (
            <VarItem
              key={output.name}
              name={output.name}
              type={getDeclaredOutputTypeLabel(output)}
              description={getOutputDescription(output, t)}
            />
          ))}
        </OutputVars>
      </div>
    </div>
  )
}
