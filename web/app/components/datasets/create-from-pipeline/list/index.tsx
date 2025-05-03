import { useCallback, useState } from 'react'
import Tab from './tab'
import BuiltInPipelineList from './built-in-pipeline-list'
import CustomizedList from './customized-list'

const OPTIONS = [
  { value: 'built-in', label: 'Built-in Pipeline' },
  { value: 'customized', label: 'Customized' },
]

const List = () => {
  const [activeTab, setActiveTab] = useState('built-in')

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab)
  }, [])

  return (
    <div className='flex grow flex-col'>
      <Tab
        activeTab={activeTab}
        handleTabChange={handleTabChange}
        options={OPTIONS}
      />
      {
        activeTab === 'built-in' && <BuiltInPipelineList />
      }
      {
        activeTab === 'customized' && <CustomizedList />
      }
    </div>
  )
}

export default List
