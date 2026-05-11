import type { FC } from 'react'
import type { PluginDetail } from '../../types'
import PluginItem from '../../plugin-item'

type IPluginListProps = {
  pluginList: PluginDetail[]
}

const PluginList: FC<IPluginListProps> = ({ pluginList }) => {
  return (
    <div className="pb-3">
      <div className="grid grid-cols-2 gap-3">
        {pluginList.map(plugin => (
          <PluginItem
            key={plugin.plugin_id}
            plugin={plugin}
          />
        ))}
      </div>
    </div>
  )
}
export default PluginList
