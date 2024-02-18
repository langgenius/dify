import { useState } from 'react'
import {
  BLOCKS,
  TABS,
} from './constants'

const Tabs = () => {
  const [activeTab, setActiveTab] = useState(TABS[0].key)

  return (
    <div>
      <div className='flex items-center justify-between px-3 h-[34px] border-b-[0.5px] border-b-black/5'>
        {
          TABS.map(tab => (
            <div
              key={tab.key}
              className={`
                text-[13px] font-medium cursor-pointer
                ${activeTab === tab.key ? 'text-gray-700' : 'text-gray-500'}
              `}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.name}
            </div>
          ))
        }
      </div>
      <div className='p-1'>
        {
          BLOCKS.map(block => (
            <div
              key={block.type}
              className='flex items-center h-8 rounded-lg hover:bg-gray-50 cursor-pointer'
            >
              <div className='mr-2 w-5 h-5' />
              <div className='text-sm text-gray-900'>{block.title}</div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

export default Tabs
