import { handleDelete } from './actions'
import TestClientPlugin from './test-client-plugin'
import Card from '@/app/components/plugins/card'
import { customTool, extensionDallE, modelGPT4, toolNotion } from '@/app/components/plugins/card/card-mock'
import PluginItem from '@/app/components/plugins/plugin-item'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import ProviderCard from '@/app/components/plugins/provider-card'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { getLocaleOnServer, useTranslation as translate } from '@/i18n/server'
import Badge from '@/app/components/base/badge'
const PluginList = async () => {
  const locale = getLocaleOnServer()
  const pluginList = [toolNotion, extensionDallE, modelGPT4, customTool]
  const { t: pluginI8n } = await translate(locale, 'plugin')
  return (
    <div className='pb-3 bg-white'>
      <div className='mx-3 '>
        <h2 className='my-3'>Dify Plugin list</h2>
        <div className='grid grid-cols-2 gap-3'>
          {pluginList.map((plugin, index) => (
            <PluginItem
              key={index}
              payload={plugin as any}
              onDelete={handleDelete}
              pluginI8n={pluginI8n}
              locale={locale}
            />
          ))}
        </div>
        <h2>Client plugin item</h2>
        <TestClientPlugin />

        <h2 className='my-3'>Install Plugin / Package under bundle</h2>
        <div className='w-[512px] rounded-2xl bg-background-section-burn p-2'>
          <Card
            payload={toolNotion as any}
            locale={locale}
            descriptionLineRows={1}
            titleLeft={
              <Badge className='ml-1' text={toolNotion.version} />
            }
          />
        </div>
        <h3 className='my-1'>Installed</h3>
        <div className='w-[512px] rounded-2xl bg-background-section-burn p-2'>
          <Card
            payload={toolNotion as any}
            locale={locale}
            descriptionLineRows={1}
            installed
          />
        </div>

        <h3 className='my-1'>Install model provide</h3>
        <div className='grid grid-cols-2 gap-3'>
          {pluginList.map((plugin, index) => (
            <ProviderCard key={index} locale={locale} payload={plugin as any} />
          ))}
        </div>

        <div className='my-3 h-[px] bg-gray-50'></div>
        <h2 className='my-3'>Marketplace Plugin list</h2>
        <div className='grid grid-cols-4 gap-3'>
          {pluginList.map((plugin, index) => (
            <Card
              key={index}
              payload={plugin as any}
              locale={locale}
              footer={
                <CardMoreInfo downloadCount={index % 2 === 0 ? 1234 : 6} tags={index % 2 === 0 ? ['Search', 'Productivity'] : []} />
              }
            />
          ))}
        </div>
      </div>
      <PluginDetailPanel
        locale={locale}
      />
    </div>
  )
}

export const metadata = {
  title: 'Plugins - Card',
}

export default PluginList
