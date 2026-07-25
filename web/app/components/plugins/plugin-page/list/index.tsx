import type { FC, ReactNode } from 'react'
import type { PluginDetail } from '../../types'
import PluginItem from '../../plugin-item'

type IPluginListProps = {
  canDeletePlugin?: boolean
  canUpdatePlugin?: boolean
  children?: ReactNode
  firstPluginTarget?: string
  pluginList: PluginDetail[]
}

const PluginList: FC<IPluginListProps> = ({
  canDeletePlugin = true,
  canUpdatePlugin = true,
  children,
  firstPluginTarget,
  pluginList,
}) => {
  return (
    <div className="pb-3">
      <div className="grid w-full grid-cols-1 gap-3 lg:grid-cols-2">
        {pluginList.map((plugin, index) => (
          <div
            key={plugin.plugin_id}
            data-step-by-step-tour-target={index === 0 ? firstPluginTarget : undefined}
          >
            <PluginItem
              plugin={plugin}
              canDeletePlugin={canDeletePlugin}
              canUpdatePlugin={canUpdatePlugin}
            />
          </div>
        ))}
        {children}
      </div>
    </div>
  )
}
export default PluginList
