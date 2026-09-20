import type { WorkflowOutputRoutes } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentV2NodeType } from '../types'
import type { NodeProps, Var } from '@/app/components/workflow/types'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import { useEdgesInteractions } from '@/app/components/workflow/hooks/use-edges-interactions'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesReadOnly, useWorkflow } from '@/app/components/workflow/hooks/use-workflow'
import {
  useWorkflowHistory,
  WorkflowHistoryEvent,
} from '@/app/components/workflow/hooks/use-workflow-history'
import { VarType } from '@/app/components/workflow/types'
import BranchList from '../../_base/components/branch-list/class-list'
import { ErrorHandleTypeEnum } from '../../_base/components/error-handle/types'

const filterVar = (variable: Var) => [VarType.string, VarType.number].includes(variable.type)

export function AgentOutputRoutes({ id, data }: NodeProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { saveStateToHistory } = useWorkflowHistory()
  const { removeUsedVarInNodes } = useWorkflow()
  const routes = data.agent_output_routes
  const list = (routes?.routes ?? []).map((route) => ({ ...route, name: route.name ?? '' }))
  const defaultLabel = (index: number) =>
    t(($) => $['nodes.agent.outputRoutes.route'], { ns: 'workflow', index })

  const update = (next: WorkflowOutputRoutes) => {
    if (routes?.enabled && list.length > 1 && (!next.enabled || (next.routes?.length ?? 0) < 2))
      removeUsedVarInNodes([id, 'switch'])
    handleNodeDataUpdateWithSyncDraft({
      id,
      data: {
        agent_output_routes: next,
        ...(next.enabled && data.error_strategy === ErrorHandleTypeEnum.defaultValue
          ? { error_strategy: undefined, default_value: undefined }
          : {}),
        _targetBranches: next.enabled
          ? next.routes?.map((route) => ({ id: route.id, name: route.name ?? '' }))
          : [],
      },
    })
    saveStateToHistory(WorkflowHistoryEvent.NodeChange)
  }
  const toggle = (enabled: boolean) => {
    const nextList =
      enabled && !list.length
        ? [1, 2].map((index) => ({ id: crypto.randomUUID(), name: '', label: defaultLabel(index) }))
        : list
    // Remove references while downstream nodes are still reachable, then remove
    // success edges. The shared history debounce captures the complete change.
    update({ enabled, routes: nextList })
    for (const handle of enabled ? ['source'] : list.map((route) => route.id))
      handleEdgeDeleteByDeleteBranch(id, handle)
  }

  return (
    <div className="border-b border-divider-subtle px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="system-sm-semibold text-text-secondary">
          {t(($) => $['nodes.agent.outputRoutes.title'], { ns: 'workflow' })}
        </span>
        <Switch
          aria-label={t(($) => $['nodes.agent.outputRoutes.title'], { ns: 'workflow' })}
          checked={!!routes?.enabled}
          disabled={nodesReadOnly}
          onCheckedChange={toggle}
        />
      </div>
      {routes?.enabled && (
        <BranchList
          nodeId={id}
          list={list}
          onChange={(routes) => update({ enabled: true, routes })}
          handleSortTopic={(routes) => update({ enabled: true, routes })}
          readonly={nodesReadOnly}
          filterVar={filterVar}
          labels={{
            title: t(($) => $['nodes.agent.outputRoutes.title'], { ns: 'workflow' }),
            add: t(($) => $['nodes.agent.outputRoutes.add'], { ns: 'workflow' }),
            placeholder: t(($) => $['nodes.agent.outputRoutes.placeholder'], { ns: 'workflow' }),
            renameHint: t(($) => $['nodes.agent.outputRoutes.renameHint'], { ns: 'workflow' }),
            defaultLabel,
          }}
        />
      )}
    </div>
  )
}
