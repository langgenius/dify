import type { FC, ReactNode } from 'react'
import type { PluginDetail } from '../../types'
import PluginItem from '../../plugin-item'

type IPluginListProps = {
  canManagePlugin?: boolean
  canUpdatePlugin?: boolean
  children?: ReactNode
  pluginList: PluginDetail[]
}

const PluginList: FC<IPluginListProps> = ({
  canManagePlugin = true,
  canUpdatePlugin = true,
  children,
  pluginList,
}) => {
  return (
    <div className="pb-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {pluginList.map(plugin => (
          <PluginItem
            key={plugin.plugin_id}
            plugin={plugin}
            canManagePlugin={canManagePlugin}
            canUpdatePlugin={canUpdatePlugin}
          />
        ))}
        {children}
      </div>
    </div>
  )
}
export default PluginList
