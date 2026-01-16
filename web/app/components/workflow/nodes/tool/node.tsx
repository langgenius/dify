import type { FC } from 'react'
import type { ToolNodeType } from './types'
import type { Node, NodeProps } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import type { AgentNodeType } from '@/app/components/workflow/nodes/agent/types'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import AlertTriangle from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback/AlertTriangle'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useNodesMetaData } from '@/app/components/workflow/hooks'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { useGetLanguage } from '@/context/i18n'
import { useStrategyProviders } from '@/service/use-strategy'
import { cn } from '@/utils/classnames'
import { VarType } from './types'

const AGENT_CONTEXT_VAR_PATTERN = /\{\{[@#]([^.@#]+)\.context[@#]\}\}/g

const Node: FC<NodeProps<ToolNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()
  const { data: strategyProviders } = useStrategyProviders()
  const nodes = useNodes<Node>()
  const { tool_configurations, paramSchemas } = data
  const toolConfigs = Object.keys(tool_configurations || {})
  const {
    isChecking,
    isMissing,
    uniqueIdentifier,
    canInstall,
    onInstallSuccess,
    shouldDim,
  } = useNodePluginInstallation(data)
  const showInstallButton = !isChecking && isMissing && canInstall && uniqueIdentifier
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const shouldLock = !isChecking && isMissing && canInstall && Boolean(uniqueIdentifier)

  useEffect(() => {
    if (data._pluginInstallLocked === shouldLock && data._dimmed === shouldDim)
      return
    handleNodeDataUpdate({
      id,
      data: {
        _pluginInstallLocked: shouldLock,
        _dimmed: shouldDim,
      },
    })
  }, [data._pluginInstallLocked, data._dimmed, handleNodeDataUpdate, id, shouldDim, shouldLock])

  const nodesById = useMemo(() => {
    return nodes.reduce((acc, node) => {
      acc[node.id] = node
      return acc
    }, {} as Record<string, Node>)
  }, [nodes])

  const mentionEntries = useMemo(() => {
    const entries: Array<{ agentNodeId: string, extractorNodeId?: string, paramKey: string }> = []
    const seen = new Set<string>()
    const toolParams = data.tool_parameters || {}
    Object.entries(toolParams).forEach(([paramKey, param]) => {
      const value = param?.value
      if (typeof value !== 'string')
        return
      const matches = value.matchAll(AGENT_CONTEXT_VAR_PATTERN)
      for (const match of matches) {
        const agentNodeId = match[1]
        if (!agentNodeId)
          continue
        const entryKey = `${paramKey}:${agentNodeId}`
        if (seen.has(entryKey))
          continue
        seen.add(entryKey)
        entries.push({
          agentNodeId,
          paramKey,
          extractorNodeId: param?.mention_config?.extractor_node_id
            || (param?.type === VarType.mention ? `${id}_ext_${paramKey}` : undefined),
        })
      }
    })
    return entries
  }, [data.tool_parameters, id])

  const referenceItems = useMemo(() => {
    if (!mentionEntries.length)
      return []

    const getNodeWarning = (node?: Node) => {
      if (!node)
        return true
      const validator = nodesMetaDataMap?.[node.data.type as BlockEnum]?.checkValid
      if (!validator)
        return false
      let moreDataForCheckValid: any
      if (node.data.type === BlockEnum.Agent) {
        const agentData = node.data as AgentNodeType
        const isReadyForCheckValid = !!strategyProviders
        const provider = strategyProviders?.find(provider => provider.declaration.identity.name === agentData.agent_strategy_provider_name)
        const strategy = provider?.declaration.strategies?.find(s => s.identity.name === agentData.agent_strategy_name)
        moreDataForCheckValid = {
          provider,
          strategy,
          language,
          isReadyForCheckValid,
        }
      }
      const { errorMessage } = validator(node.data as any, t, moreDataForCheckValid)
      return Boolean(errorMessage)
    }

    return mentionEntries.map(({ agentNodeId, extractorNodeId, paramKey }) => {
      const agentNode = nodesById[agentNodeId]
      const agentLabel = `@${agentNode?.data.title || agentNodeId}`
      const agentWarning = getNodeWarning(agentNode)

      const extractorWarning = extractorNodeId
        ? getNodeWarning(nodesById[extractorNodeId])
        : false
      const hasWarning = agentWarning || extractorWarning
      return {
        key: `${paramKey}-${agentNodeId}-${extractorNodeId || 'no-extractor'}`,
        label: agentLabel,
        type: BlockEnum.Agent,
        hasWarning,
      }
    })
  }, [mentionEntries, nodesById, nodesMetaDataMap, strategyProviders, language, t])

  const hasConfigs = toolConfigs.length > 0
  const hasReferences = referenceItems.length > 0

  if (!showInstallButton && !hasConfigs && !hasReferences)
    return null

  return (
    <div className="relative mb-1 px-3 py-1">
      {showInstallButton && (
        <div className="pointer-events-auto absolute right-3 top-[-32px] z-40">
          <InstallPluginButton
            size="small"
            className="!font-medium !text-text-accent"
            extraIdentifiers={[
              data.plugin_id,
              data.provider_id,
              data.provider_name,
            ].filter(Boolean) as string[]}
            uniqueIdentifier={uniqueIdentifier!}
            onSuccess={onInstallSuccess}
          />
        </div>
      )}
      {hasConfigs && (
        <div className="space-y-0.5" aria-disabled={shouldDim}>
          {toolConfigs.map((key, index) => (
            <div key={index} className="flex h-6 items-center justify-between space-x-1 rounded-md  bg-workflow-block-parma-bg px-1 text-xs font-normal text-text-secondary">
              <div title={key} className="max-w-[100px] shrink-0 truncate text-xs font-medium uppercase text-text-tertiary">
                {key}
              </div>
              {typeof tool_configurations[key].value === 'string' && (
                <div title={tool_configurations[key].value} className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary">
                  {paramSchemas?.find(i => i.name === key)?.type === FormTypeEnum.secretInput ? '********' : tool_configurations[key].value}
                </div>
              )}
              {typeof tool_configurations[key].value === 'number' && (
                <div title={Number.isNaN(tool_configurations[key].value) ? '' : tool_configurations[key].value} className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary">
                  {Number.isNaN(tool_configurations[key].value) ? '' : tool_configurations[key].value}
                </div>
              )}
              {typeof tool_configurations[key] !== 'string' && tool_configurations[key]?.type === FormTypeEnum.modelSelector && (
                <div title={tool_configurations[key].model} className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary">
                  {tool_configurations[key].model}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {hasReferences && (
        <div className={cn('space-y-0.5', hasConfigs && 'mt-1')} aria-disabled={shouldDim}>
          {referenceItems.map(item => (
            <div
              key={item.key}
              className={cn(
                'flex h-6 items-center justify-between space-x-1 rounded-md border px-1 text-xs font-normal text-text-secondary',
                item.hasWarning
                  ? 'border-text-warning-secondary bg-components-badge-status-light-warning-halo'
                  : 'border-transparent bg-workflow-block-parma-bg',
              )}
            >
              <div className="flex min-w-0 items-center gap-1">
                <BlockIcon
                  className="shrink-0"
                  type={item.type}
                  size="xs"
                />
                <span title={item.label} className="system-xs-medium truncate text-text-secondary">
                  {item.label}
                </span>
              </div>
              {item.hasWarning && (
                <AlertTriangle className="h-3.5 w-3.5 text-text-warning-secondary" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
