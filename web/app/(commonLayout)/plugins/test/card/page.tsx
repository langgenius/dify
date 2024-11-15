'use client'
import Card from '@/app/components/plugins/card'
import { customTool, extensionDallE, modelGPT4, toolNotion } from '@/app/components/plugins/card/card-mock'
// import PluginItem from '@/app/components/plugins/plugin-item'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
// import ProviderCard from '@/app/components/plugins/provider-card'
import Badge from '@/app/components/base/badge'
import InstallBundle from '@/app/components/plugins/install-plugin/install-bundle'

const PluginList = () => {
  const pluginList = [toolNotion, extensionDallE, modelGPT4, customTool]

  return (
    <div className='pb-3 bg-white'>
      <InstallBundle onClose={() => { }} fromDSLPayload={[
        {
          type: 'marketplace',
          value: {
            plugin_unique_identifier: 'langgenius/google:0.0.2@dcb354c9d0fee60e6e9c9eb996e1e485bbef343ba8cd545c0cfb3ec80970f6f1',
          },
        },
        {
          type: 'github',
          value: {
            repo: 'YIXIAO0/test',
            version: '1.11.5',
            package: 'test.difypkg',
            github_plugin_unique_identifier: 'yixiao0/test:0.0.1@3592166c87afcf944b4f13f27467a5c8f9e00bd349cb42033a072734a37431b4',
          },
        },
        {
          type: 'marketplace',
          value: {
            plugin_unique_identifier: 'langgenius/openai:0.0.1@f88fdb98d104466db16a425bfe3af8c1bcad45047a40fb802d98a989ac57a5a3',
          },
        },
      ]} />
      <div className='mx-3 '>
        {/* <h2 className='my-3'>Dify Plugin list</h2> */}
        {/* <div className='grid grid-cols-2 gap-3'>
          {pluginList.map((plugin, index) => (
            <PluginItem
              key={index}
              payload={plugin as any}
              onDelete={handleDelete}
            />
          ))}
        </div> */}

        <h2 className='my-3'>Install Plugin / Package under bundle</h2>
        <div className='w-[512px] rounded-2xl bg-background-section-burn p-2'>
          <Card
            payload={toolNotion as any}
            descriptionLineRows={1}
            titleLeft={
              <Badge className='ml-1' text={toolNotion.version} />
            }
          />
        </div>
        {/* <h3 className='my-1'>Installed</h3>
        <div className='w-[512px] rounded-2xl bg-background-section-burn p-2'>
          <Card
            payload={toolNotion as any}
            descriptionLineRows={1}
            installed
          />
        </div> */}

        {/* <h3 className='my-1'>Install model provide</h3>
        <div className='grid grid-cols-2 gap-3'>
          {pluginList.map((plugin, index) => (
            <ProviderCard key={index} payload={plugin as any} />
          ))}
        </div> */}

        <div className='my-3 h-[px] bg-gray-50'></div>
        <h2 className='my-3'>Marketplace Plugin list</h2>
        <div className='grid grid-cols-4 gap-3'>
          {pluginList.map((plugin, index) => (
            <Card
              key={index}
              payload={plugin as any}
              footer={
                <CardMoreInfo downloadCount={index % 2 === 0 ? 1234 : 6} tags={index % 2 === 0 ? ['Search', 'Tag that has very very long name', 'Productivity', 'Tag2'] : []} />
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// export const metadata = {
//   title: 'Plugins - Card',
// }

export default PluginList
