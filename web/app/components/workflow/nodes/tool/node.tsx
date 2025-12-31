import type { FC } from 'react'
import type { ToolNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useEffect } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'

const Node: FC<NodeProps<ToolNodeType>> = ({
  id,
  data,
}) => {
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

  const hasConfigs = toolConfigs.length > 0

  if (!showInstallButton && !hasConfigs)
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
    </div>
  )
}

export default React.memo(Node)
