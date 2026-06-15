import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentRosterNodeData } from '../../block-selector/types'
import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { consoleQuery } from '@/service/client'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'

const i18nPrefix = 'nodes.agent'

const defaultEffectiveOutputs: DeclaredOutputConfig[] = [
  {
    name: 'text',
    type: 'string',
    required: false,
    description: 'Free-form text answer.',
  },
  {
    name: 'files',
    type: 'array',
    required: false,
    description: 'Files produced by the agent.',
    array_item: {
      type: 'file',
    },
  },
  {
    name: 'json',
    type: 'object',
    required: false,
    description: 'Free-form JSON object.',
  },
]

const outputTypeLabels: Record<DeclaredOutputConfig['type'], string> = {
  array: 'Array',
  boolean: 'Boolean',
  file: 'File',
  number: 'Number',
  object: 'Object',
  string: 'String',
}

function getOutputTypeLabel(output: DeclaredOutputConfig) {
  if (output.type === 'array')
    return `Array[${output.array_item ? outputTypeLabels[output.array_item.type] : 'Object'}]`

  return outputTypeLabels[output.type]
}

function getOutputDescription(
  output: DeclaredOutputConfig,
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
  const appId = useHooksStore(s => s.configsMap?.flowId)
  const queryClient = useQueryClient()
  const composerQueryInput = appId
    ? {
        params: {
          app_id: appId,
          node_id: id,
        },
      }
    : skipToken
  const composerQueryKey = appId
    ? consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
        input: {
          params: {
            app_id: appId,
            node_id: id,
          },
        },
      })
    : undefined
  const composerQuery = useQuery(consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryOptions({
    input: composerQueryInput,
  }))
  const effectiveOutputs = composerQuery.data?.effective_declared_outputs?.length
    ? composerQuery.data.effective_declared_outputs
    : defaultEffectiveOutputs

  const handleTaskChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_task = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRosterChange = useCallback((agent: AgentRosterNodeData) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_roster = agent
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
        callback: {
          onSuccess: () => {
            if (composerQueryKey)
              void queryClient.invalidateQueries({ queryKey: composerQueryKey })
          },
        },
      },
    )
  }, [composerQueryKey, handleNodeDataUpdateWithSyncDraft, id, inputs, queryClient])

  return (
    <div ref={drawerPortalContainerRef} className="pt-2">
      <div className="border-b border-divider-subtle">
        <AgentRosterField
          agent={inputs.agent_roster}
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
          {effectiveOutputs.map(output => (
            <VarItem
              key={output.name}
              name={output.name}
              type={getOutputTypeLabel(output)}
              description={getOutputDescription(output, t)}
            />
          ))}
        </OutputVars>
      </div>
    </div>
  )
}
