import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import PluginItem from '../../plugin-item'
import { customTool, extensionDallE, modelGPT4, toolNotion } from '@/app/components/plugins/card/card-mock'
import I18n from '@/context/i18n'

const PluginList = () => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
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
              pluginI8n={t}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
export default PluginList
