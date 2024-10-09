import Card from '@/app/components/plugins/card'
import { extensionDallE, modelGPT4, toolNotion } from '@/app/components/plugins/card-mock'
import PluginItem from '@/app/components/plugins/plugin-item'

const PluginList = async () => {
  return (
    <div className='pb-3 bg-white'>
      <div className='mx-3 '>
        <h2 className='my-3'>Dify Plugin list</h2>
        <div className='grid grid-cols-2 gap-3'>
          <PluginItem payload={toolNotion as any} />
          <PluginItem payload={extensionDallE as any} />
          <PluginItem payload={modelGPT4 as any} />
          <PluginItem payload={toolNotion as any} />
          <PluginItem payload={toolNotion as any} />
        </div>

        <h2 className='my-3'>Install Plugin / Package under bundle</h2>
        <div className='w-[512px] rounded-2xl bg-background-section-burn p-2'>
          <Card
            payload={toolNotion as any}
            descriptionLineRows={1}
          />
        </div>
        <h3 className='my-1'>Installed</h3>
        <div className='w-[512px] rounded-2xl bg-background-section-burn p-2'>
          <Card
            payload={toolNotion as any}
            descriptionLineRows={1}
            installed
          />
        </div>

        <div className='my-3 h-[px] bg-gray-50'></div>
        <h2 className='my-3'>Marketplace Plugin list</h2>
        <div className='grid grid-cols-4 gap-3'>
          <Card payload={toolNotion as any} />
          <Card payload={extensionDallE as any} />
          <Card payload={modelGPT4 as any} />
          <Card payload={toolNotion as any} />
          <Card payload={toolNotion as any} />
        </div>
      </div>
    </div>
  )
}

export const metadata = {
  title: 'Plugins - Card',
}

export default PluginList
