import type { FC } from 'react'
import PluginItem from '../../plugin-item'
import type { InstalledPlugin } from '../../types'

type IPluginListProps = {
  pluginList: InstalledPlugin[]
}

const PluginList: FC<IPluginListProps> = ({ pluginList }) => {
  return (
    <div className='pb-3 bg-white'>
      <div className='grid grid-cols-2 gap-3'>
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
