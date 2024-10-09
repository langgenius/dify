import Card from '@/app/components/plugins/card'
import { extensionDallE, modelGPT4, toolNotion } from '@/app/components/plugins/card-mock'

const PluginList = async () => {
  return (
    <>
      <div className='mx-3 grid grid-cols-4 gap-3'>
        <Card payload={toolNotion as any} />
        <Card payload={extensionDallE as any} />
        <Card payload={modelGPT4 as any} />
        <Card payload={toolNotion as any} />
        <Card payload={toolNotion as any} />
      </div>
    </>
  )
}

export const metadata = {
  title: 'Plugins - Card',
}

export default PluginList
