'use client'

import type { UnsupportedNode, WorkflowPath } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { Emoji } from '@/app/components/tools/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetProviderIcon } from './use-provider-icon'
import { workflowPathKey } from './utils/workflow-path'
import { WorkflowDependencyPreview } from './workflow-source-popover'

const WORKFLOW_BLOCK_TYPES = new Set<string>(Object.values(BlockEnum))

function isWorkflowBlockType(type: string): type is BlockEnum {
  return WORKFLOW_BLOCK_TYPES.has(type)
}

function UnsupportedNodeIcon({ node, icon }: { node: UnsupportedNode; icon?: string | Emoji }) {
  if (!isWorkflowBlockType(node.type)) {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-midnight-solid text-white shadow-xs">
        <span aria-hidden className="i-ri-node-tree size-3.5" />
      </span>
    )
  }

  return <BlockIcon type={node.type} size="sm" toolIcon={icon} />
}

type UnsupportedNodeGroup = {
  key: string
  node: UnsupportedNode
  paths: WorkflowPath[]
}

type MutableUnsupportedNodeGroup = UnsupportedNodeGroup & {
  hasDeployedAppNode: boolean
  pathKeys: Set<string>
}

function unsupportedNodeGroupKey(node: UnsupportedNode) {
  return JSON.stringify([
    node.type,
    node.title,
    node.provider?.plugin_id,
    node.provider?.provider_id,
    node.provider?.provider_type,
    node.provider?.provider_name,
  ])
}

function groupUnsupportedNodes(nodes: UnsupportedNode[]): UnsupportedNodeGroup[] {
  const groups = new Map<string, MutableUnsupportedNodeGroup>()

  for (const node of nodes) {
    const key = unsupportedNodeGroupKey(node)
    let group = groups.get(key)

    if (!group) {
      group = {
        hasDeployedAppNode: false,
        key,
        node,
        pathKeys: new Set<string>(),
        paths: [],
      }
      groups.set(key, group)
    }

    const dependency = node.workflow_as_tool_dependency
    if (!dependency) {
      group.hasDeployedAppNode = true
      continue
    }

    for (const path of dependency.paths) {
      if (path.workflows.length === 0) continue

      const pathKey = workflowPathKey(path)
      if (group.pathKeys.has(pathKey)) continue

      group.pathKeys.add(pathKey)
      group.paths.push(path)
    }
  }

  return [...groups.values()].map(
    ({ hasDeployedAppNode, key, node, pathKeys, paths }): UnsupportedNodeGroup => {
      if (!hasDeployedAppNode) return { key, node, paths }

      // Root occurrences have no dependency payload. When a matching node also appears in a
      // subworkflow, its paths provide the deployed app reference for the root-only source row.
      const deployedAppPaths: WorkflowPath[] = []
      for (const path of paths) {
        const deployedApp = path.workflows[0]
        if (!deployedApp) continue

        const deployedAppPath = { workflows: [deployedApp] }
        const deployedAppPathKey = workflowPathKey(deployedAppPath)
        if (pathKeys.has(deployedAppPathKey)) continue

        pathKeys.add(deployedAppPathKey)
        deployedAppPaths.push(deployedAppPath)
      }

      return {
        key,
        node,
        paths: [...deployedAppPaths, ...paths],
      }
    },
  )
}

export function DeploymentPrecheckAlert({ nodes }: { nodes: UnsupportedNode[] }) {
  const { t } = useTranslation('deployments')
  const getProviderIcon = useGetProviderIcon(nodes)
  const nodeGroups = useMemo(() => groupUnsupportedNodes(nodes), [nodes])

  return (
    <div
      role="alert"
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4 shadow-xs backdrop-blur-[5px]"
    >
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-components-badge-status-light-warning-halo to-background-gradient-mask-transparent opacity-40" />
      <span
        aria-hidden
        className="relative i-ri-alert-fill size-5 shrink-0 text-text-warning-secondary"
      />
      <div className="relative flex min-w-0 flex-col gap-1">
        <p className="system-sm-medium text-text-primary">{t(($) => $['studio.precheck.title'])}</p>
        <p className="system-xs-regular text-text-secondary">
          {t(($) => $['studio.precheck.description'])}
        </p>
      </div>
      <ul className="relative flex flex-col gap-1.5 border-y border-divider-regular py-3">
        {nodeGroups.map(({ key, node, paths }) => (
          <li key={key} className="flex items-center gap-2 pr-1">
            <UnsupportedNodeIcon node={node} icon={getProviderIcon(node)} />
            <span className="min-w-0 flex-1 truncate system-xs-medium text-text-secondary">
              {node.title}
            </span>
            <WorkflowDependencyPreview subjectName={node.title} paths={paths} />
          </li>
        ))}
      </ul>
      <p className="relative system-xs-regular text-text-secondary">
        {t(($) => $['studio.precheck.supportMessage'])}
      </p>
    </div>
  )
}
