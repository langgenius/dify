'use client'

import type {
  UnsupportedNode,
  WorkflowReference,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { Emoji } from '@/app/components/tools/types'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import Link from '@/next/link'
import { useGetProviderIcon } from './use-provider-icon'

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
  sources: WorkflowReference[]
}

type MutableUnsupportedNodeGroup = UnsupportedNodeGroup & {
  sourceKeys: Set<string>
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
        key,
        node,
        sourceKeys: new Set<string>(),
        sources: [],
      }
      groups.set(key, group)
    }

    const source = node.from_subworkflow
    if (!source) continue

    const sourceKey = `${source.app_id}:${source.workflow_id}`
    if (group.sourceKeys.has(sourceKey)) continue

    group.sourceKeys.add(sourceKey)
    group.sources.push(source)
  }

  return [...groups.values()].map(({ key, node, sources }) => ({ key, node, sources }))
}

function SubworkflowSourcePreview({
  nodeTitle,
  sources,
}: {
  nodeTitle: string
  sources: WorkflowReference[]
}) {
  const { t } = useTranslation('deployments')
  const [firstSource] = sources

  if (!firstSource) return null

  const sourceLabel =
    sources.length === 1
      ? firstSource.name
      : t(($) => $['studio.precheck.nodeCount_other'], { count: sources.length })

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={
          <button
            type="button"
            className="group/source ml-auto flex shrink-0 cursor-help items-center gap-1 rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
          >
            <span className="sr-only">{nodeTitle}: </span>
            <span className="system-xs-regular text-text-tertiary">
              {t(($) => $['studio.precheck.from'])}
            </span>
            <span className="border-b border-dotted border-text-quaternary system-xs-regular text-text-tertiary group-hover/source:text-text-secondary group-data-popup-open/source:text-text-secondary">
              {sourceLabel}
            </span>
          </button>
        }
      />
      <PopoverContent
        placement="top-end"
        sideOffset={4}
        className="max-w-[calc(100vw-32px)] min-w-76 bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]"
      >
        <PopoverTitle className="sr-only">{nodeTitle}</PopoverTitle>
        <ul className="flex flex-col gap-px">
          {sources.map((source) => (
            <li key={`${source.app_id}:${source.workflow_id}`}>
              <Link
                href={`/app/${source.app_id}/workflow`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex min-h-7 min-w-0 items-center gap-1 rounded-md p-1 system-sm-regular text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid"
              >
                <span aria-hidden className="size-5 shrink-0 rounded-md bg-black" />
                <span className="min-w-0 flex-1 truncate">{source.name}</span>
                <span
                  aria-hidden
                  className="i-ri-external-link-line size-3 shrink-0 text-text-tertiary group-hover:text-text-secondary"
                />
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
        {nodeGroups.map(({ key, node, sources }) => (
          <li key={key} className="flex min-w-0 items-center gap-2 pr-1">
            <UnsupportedNodeIcon node={node} icon={getProviderIcon(node)} />
            <span className="min-w-0 truncate system-xs-medium text-text-secondary">
              {node.title}
            </span>
            <SubworkflowSourcePreview nodeTitle={node.title} sources={sources} />
          </li>
        ))}
      </ul>
      <p className="relative system-xs-regular text-text-secondary">
        {t(($) => $['studio.precheck.supportMessage'])}
      </p>
    </div>
  )
}
