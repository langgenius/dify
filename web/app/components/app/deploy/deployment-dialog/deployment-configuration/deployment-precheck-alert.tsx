'use client'

import type { UnsupportedNode } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { Emoji } from '@/app/components/tools/types'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetProviderIcon } from './use-provider-icon'

const WORKFLOW_BLOCK_TYPES = new Set<string>(Object.values(BlockEnum))

function isWorkflowBlockType(type: string): type is BlockEnum {
  return WORKFLOW_BLOCK_TYPES.has(type)
}

function UnsupportedNodeIcon({ node, icon }: { node: UnsupportedNode; icon?: string | Emoji }) {
  if (!isWorkflowBlockType(node.type)) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-components-icon-bg-midnight-solid text-white shadow-xs">
        <span aria-hidden className="i-ri-node-tree size-3" />
      </span>
    )
  }

  return <BlockIcon type={node.type} size="xs" toolIcon={icon} />
}

export function DeploymentPrecheckAlert({ nodes }: { nodes: UnsupportedNode[] }) {
  const { t } = useTranslation('deployments')
  const getProviderIcon = useGetProviderIcon(nodes)

  return (
    <div
      role="alert"
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-3 shadow-xs backdrop-blur-[5px]"
    >
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-components-badge-status-light-warning-halo to-background-gradient-mask-transparent opacity-40" />
      <span
        aria-hidden
        className="relative i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary"
      />
      <div className="relative flex min-w-0 flex-col gap-1">
        <p className="system-sm-medium text-text-primary">{t(($) => $['studio.precheck.title'])}</p>
        <p className="system-xs-regular text-text-secondary">
          {t(($) => $['studio.precheck.description'])}
        </p>
        <ul className="flex flex-col gap-2 py-1">
          {nodes.map((node) => (
            <li key={node.id} className="flex min-w-0 items-center gap-2">
              <UnsupportedNodeIcon node={node} icon={getProviderIcon(node)} />
              <span className="min-w-0 truncate system-xs-medium text-text-secondary">
                {node.title}
              </span>
            </li>
          ))}
        </ul>
        <p className="system-xs-regular text-text-secondary">
          {t(($) => $['studio.precheck.supportMessage'])}
        </p>
      </div>
    </div>
  )
}
