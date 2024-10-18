import PluginItem from '../../plugin-item'
import { customTool, extensionDallE, modelGPT4, toolNotion } from '@/app/components/plugins/card/card-mock'

const PluginList = () => {
  const pluginList = [toolNotion, extensionDallE, modelGPT4, customTool]

  return (
    <div className='pb-3 bg-white'>
      <div>
        <div className='grid grid-cols-2 gap-3'>
          {pluginList.map((plugin, index) => (
            <PluginItem
              key={index}
              payload={plugin as any}
              onDelete={() => {}}
              source={'debug'}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
export default PluginList
