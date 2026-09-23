import type { WorkflowOutputRoutes } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentV2NodeType } from '../types'
import type { NodeProps, Var } from '@/app/components/workflow/types'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import { useEdgesInteractions } from '@/app/components/workflow/hooks/use-edges-interactions'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useNodesReadOnly, useWorkflow } from '@/app/components/workflow/hooks/use-workflow'
import {
  useWorkflowHistory,
  WorkflowHistoryEvent,
} from '@/app/components/workflow/hooks/use-workflow-history'
import { VarType } from '@/app/components/workflow/types'
import BranchList from '../../_base/components/branch-list/class-list'
import { ErrorHandleTypeEnum } from '../../_base/components/error-handle/types'

const filterVar = (variable: Var) =>
  variable.type === VarType.string || variable.type === VarType.number

export function AgentOutputRoutes({ id, data }: NodeProps<AgentV2NodeType>) {
  const { t } = useTranslation(['workflow'])
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const { removeBranchEdges } = useEdgesInteractions()
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()
  const { removeUsedVarInNodes } = useWorkflow()
  const routes = data.agent_output_routes
  const list = (routes?.routes ?? []).map((route) => ({ ...route, name: route.name ?? '' }))
  const defaultLabel = (index: number) =>
    t(($) => $['nodes.agent.outputRoutes.route'], { ns: 'workflow', index })

  const update = (next: WorkflowOutputRoutes) => {
    if (getNodesReadOnly()) return

    const nextRoutes = next.routes?.map(({ id, name, label }) => ({ id, name, label }))
    const currentHandles = routes?.enabled ? list.map((route) => route.id) : ['source']
    const nextHandles = next.enabled ? (nextRoutes ?? []).map((route) => route.id) : ['source']
    // Downstream references must be removed before their connecting edges disappear.
    if (routes?.enabled && !next.enabled) removeUsedVarInNodes([id, 'switch'])
    handleNodeDataUpdate({
      id,
      data: {
        agent_output_routes: { ...next, routes: nextRoutes },
        ...(next.enabled && data.error_strategy === ErrorHandleTypeEnum.defaultValue
          ? { error_strategy: undefined, default_value: undefined }
          : {}),
        _targetBranches: next.enabled
          ? nextRoutes?.map((route) => ({ id: route.id, name: route.name ?? '' }))
          : [],
      },
    })
    removeBranchEdges(
      id,
      currentHandles.filter((handle) => !nextHandles.includes(handle)),
    )
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.NodeChange)
  }
  const toggle = (enabled: boolean) => {
    const nextList = [...list]
    if (enabled) {
      while (nextList.length < 2)
        nextList.push({
          id: crypto.randomUUID(),
          name: '',
          label: defaultLabel(nextList.length + 1),
        })
    }
    update({ enabled, routes: nextList })
  }

  return (
    <div className="border-b border-divider-subtle px-4 py-3">
      <BranchList
        nodeId={id}
        list={list}
        minItems={2}
        enabled={!!routes?.enabled}
        actions={
          <Switch
            aria-label={t(($) => $['nodes.agent.outputRoutes.title'], { ns: 'workflow' })}
            checked={!!routes?.enabled}
            disabled={nodesReadOnly}
            onCheckedChange={toggle}
          />
        }
        onChange={(routes) => update({ enabled: true, routes })}
        onRemove={(routeId) =>
          update({ enabled: true, routes: list.filter((route) => route.id !== routeId) })
        }
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
    </div>
  )
}
