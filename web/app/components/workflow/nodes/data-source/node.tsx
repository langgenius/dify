import type { FC } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { memo } from 'react'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'

const Node: FC<NodeProps<DataSourceNodeType>> = ({
  data,
}) => {
  const {
    isChecking,
    isMissing,
    uniqueIdentifier,
    canInstall,
    onInstallSuccess,
  } = useNodePluginInstallation(data)

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
