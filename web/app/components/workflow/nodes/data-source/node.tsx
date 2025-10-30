import type { FC } from 'react'
import { memo } from 'react'
import type { NodeProps } from '@/app/components/workflow/types'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import type { DataSourceNodeType } from './types'

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
    <div className='relative mb-1 px-3 py-1'>
      <div className='absolute right-3 top-[-32px] z-20'>
        <InstallPluginButton
          size='small'
          extraIdentifiers={[
            data.plugin_id,
            data.provider_name,
          ].filter(Boolean) as string[]}
          className='!font-medium !text-text-accent'
          uniqueIdentifier={uniqueIdentifier!}
          onSuccess={onInstallSuccess}
        />
      </div>
    </div>
  )
}

export default memo(Node)
