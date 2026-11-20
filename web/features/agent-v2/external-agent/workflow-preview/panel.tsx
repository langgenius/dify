import type { ExternalAgentWorkflowPreviewNodeData } from './types'
import type {
  AgentBinding,
  AgentRosterNodeData,
} from '@/app/components/workflow/block-selector/types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { mergeDefaultValue } from '@/app/components/workflow/nodes/_base/components/error-handle/utils'
import { AgentOutputVariables } from '@/app/components/workflow/nodes/agent-v2/components/agent-output-variables'
import { useCreateInlineAgentBinding } from '@/app/components/workflow/nodes/agent-v2/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { toExternalAgentOverview } from '../model'
import { ExternalAgentField } from './agent-field'
import { externalAgentDefaultOutputs, externalAgentDefaultWaitLimit } from './defaults'
import { ExternalAgentTaskField } from './task-field'
import { isExternalAgentWorkflowPreviewData } from './types'
import { useExternalAgentBinding } from './use-agent-binding'
import { ExternalAgentWaitLimit } from './wait-limit'

const externalReservedOutputNames: ReadonlySet<string> = new Set()
type PreviewUpdate =
  | Partial<ExternalAgentWorkflowPreviewNodeData>
  | ((
      current: ExternalAgentWorkflowPreviewNodeData,
    ) => Partial<ExternalAgentWorkflowPreviewNodeData>)

export function ExternalAgentWorkflowPreviewPanel({
  id,
  data,
}: {
  id: string
  data: ExternalAgentWorkflowPreviewNodeData
}) {
  const { t } = useTranslation(['agentRoster'])
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { handleNodeDataUpdate, handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const workflowStore = useWorkflowStore()
  const { createInlineAgentBinding } = useCreateInlineAgentBinding()
  const { nodesReadOnly } = useNodesReadOnly()
  const [outputsCollapsed, setOutputsCollapsed] = useState(false)
  const [isStartingFromScratch, setIsStartingFromScratch] = useState(false)
  const [hasStartFromScratchError, setHasStartFromScratchError] = useState(false)
  const agentId = data.agent_binding?.agent_id
  const agent = useQuery(
    consoleQuery.externalAgents.byAgentId.get.queryOptions({
      input: agentId ? { params: { agent_id: agentId } } : skipToken,
      select: toExternalAgentOverview,
    }),
  )
  const { changeAgent, isChanging, hasError } = useExternalAgentBinding(id)
  const switchToDifyAgent = useCallback(
    (binding: AgentBinding, title?: string) => {
      const changes = {
        agent_node_kind: 'dify_agent',
        agent_binding: binding,
        agent_declared_outputs: [],
        agent_output_routes: undefined,
        external_wait: undefined,
        error_strategy: undefined,
        default_value: undefined,
        retry_config: undefined,
        _targetBranches: [],
        _singleRunningStatus: undefined,
        _isSingleRun: undefined,
        ...(title ? { title } : {}),
      }
      handleNodeDataUpdate({ id, data: changes })
    },
    [handleNodeDataUpdate, id],
  )
  const selectDifyAgent = useCallback(
    (agent: AgentRosterNodeData) => {
      switchToDifyAgent({ binding_type: 'roster_agent', agent_id: agent.id }, agent.name)
      void doSyncWorkflowDraft(true)
    },
    [doSyncWorkflowDraft, switchToDifyAgent],
  )
  const startFromScratch = useCallback(async () => {
    setIsStartingFromScratch(true)
    setHasStartFromScratchError(false)
    const { debouncedSyncWorkflowDraft, setOpenInlineAgentPanelNodeId } = workflowStore.getState()
    debouncedSyncWorkflowDraft.cancel?.()
    try {
      // Persist the external node before the composer replaces its binding.
      const saved = await doSyncWorkflowDraft(true)
      if (!saved?.hash) {
        setHasStartFromScratchError(true)
        return
      }
      await createInlineAgentBinding(id, {
        onError: () => setHasStartFromScratchError(true),
        onSuccess: (binding) => {
          switchToDifyAgent(binding)
          void doSyncWorkflowDraft(true)
          setOpenInlineAgentPanelNodeId(id)
        },
      })
    } catch {
      setHasStartFromScratchError(true)
    } finally {
      setIsStartingFromScratch(false)
    }
  }, [createInlineAgentBinding, doSyncWorkflowDraft, id, switchToDifyAgent, workflowStore])
  const task = data.agent_task ?? ''
  const outputs = data.agent_declared_outputs?.length
    ? data.agent_declared_outputs
    : externalAgentDefaultOutputs
  const update = useCallback(
    (patch: PreviewUpdate) => {
      const current = collaborativeWorkflow.getState().nodes.find((node) => node.id === id)
      if (!current || !isExternalAgentWorkflowPreviewData(current.data)) return
      let changes = typeof patch === 'function' ? patch(current.data) : patch
      if (
        changes.agent_declared_outputs !== undefined &&
        current.data.error_strategy === ErrorHandleTypeEnum.defaultValue
      ) {
        const previousOutputs = current.data.agent_declared_outputs ?? externalAgentDefaultOutputs
        const nextOutputs = changes.agent_declared_outputs
        const renamedOutputs =
          previousOutputs.length === nextOutputs.length
            ? previousOutputs.flatMap((output, index) =>
                output.name === nextOutputs[index]!.name
                  ? []
                  : [{ from: output.name, to: nextOutputs[index]!.name }],
              )
            : []
        changes = {
          ...changes,
          default_value: mergeDefaultValue(
            { ...current.data, ...changes },
            current.data.default_value,
            renamedOutputs.length === 1 ? renamedOutputs[0] : undefined,
          ),
        }
      }
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: changes,
      })
    },
    [id, collaborativeWorkflow, handleNodeDataUpdateWithSyncDraft],
  )

  return (
    <>
      <ExternalAgentField
        binding={data.agent_binding}
        overview={agent.data}
        isChanging={isChanging || isStartingFromScratch}
        hasError={hasError || hasStartFromScratchError}
        readOnly={nodesReadOnly}
        onChange={(agent) => {
          setHasStartFromScratchError(false)
          return changeAgent(agent)
        }}
        onSelectDify={selectDifyAgent}
        onStartFromScratch={() => void startFromScratch()}
      />
      {agent.isError && (
        <p role="status" className="px-4 py-2 system-xs-regular text-text-tertiary">
          {t(($) => $['external.workflow.detailUnavailable'])}
        </p>
      )}
      <ExternalAgentTaskField
        id={id}
        inputModes={agent.data?.inputModes ?? []}
        readOnly={nodesReadOnly}
        value={task}
        outputs={outputs}
        onChange={(agent_task) => update({ agent_task })}
        onOutputsChange={(agent_declared_outputs, agent_task) =>
          update({ agent_declared_outputs, ...(agent_task === undefined ? {} : { agent_task }) })
        }
      />
      <fieldset disabled={nodesReadOnly} className="border-b border-divider-subtle">
        <AgentOutputVariables
          compact
          reservedOutputNames={externalReservedOutputNames}
          outputs={outputs}
          collapsed={outputsCollapsed}
          onCollapse={setOutputsCollapsed}
          onChange={(agent_declared_outputs) => update({ agent_declared_outputs })}
        />
      </fieldset>
      <fieldset disabled={nodesReadOnly}>
        <ExternalAgentWaitLimit
          value={{ ...externalAgentDefaultWaitLimit, ...data.external_wait }}
          onChange={(changes) =>
            update((current) => ({
              external_wait: {
                ...externalAgentDefaultWaitLimit,
                ...current.external_wait,
                ...changes,
              },
            }))
          }
        />
      </fieldset>
    </>
  )
}
