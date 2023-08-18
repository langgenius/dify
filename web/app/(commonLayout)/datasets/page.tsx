import Datasets from './Datasets'
import DatasetFooter from './DatasetFooter'

const AppList = async () => {
  return (
    <div className='flex flex-col overflow-auto bg-gray-100 shrink-0 grow'>
      <Datasets />
      <DatasetFooter />
    </div >
  )
}

export const metadata = {
  title: 'Datasets - Dify',
}

export default AppList
