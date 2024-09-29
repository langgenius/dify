import Container from './Container'
import ListItem from '@/app/components/plugins/list-item-for-test'

const PluginList = async () => {
  const mockList = ['Plugin 1', 'Plugin 2', 'Plugin 3']
  return (
    <>
      <Container />
      <div>
        {mockList.map(item => (
          <ListItem key={item} text={item} />
        ))}
      </div>
    </>
  )
}

export const metadata = {
  title: 'Plugins - Dify',
}

export default PluginList
