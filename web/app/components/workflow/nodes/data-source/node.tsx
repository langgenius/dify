import type { FC } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { memo, useEffect } from 'react'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'

const Node: FC<NodeProps<DataSourceNodeType>> = ({
  id,
  data,
}) => {
  const {
    isChecking,
    isMissing,
    uniqueIdentifier,
    canInstall,
    onInstallSuccess,
    shouldDim,
  } = useNodePluginInstallation(data)
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

  const showInstallButton = !isChecking && isMissing && canInstall && uniqueIdentifier

  if (!showInstallButton)
    return null

  return (
    <div className="relative mb-1 px-3 py-1">
      <div className="pointer-events-auto absolute right-3 top-[-32px] z-40">
        <InstallPluginButton
          size="small"
          extraIdentifiers={[
            data.plugin_id,
            data.provider_name,
          ].filter(Boolean) as string[]}
          className="!font-medium !text-text-accent"
          uniqueIdentifier={uniqueIdentifier!}
          onSuccess={onInstallSuccess}
        />
      </div>
    </div>
  )
}

export default memo(Node)
