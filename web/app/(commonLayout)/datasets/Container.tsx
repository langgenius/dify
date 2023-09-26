'use client'

import { useState } from 'react'
import Datasets from './Datasets'
import DatasetFooter from './DatasetFooter'
import ApiServer from './ApiServer'
import Doc from './Doc'
import TabSlider from '@/app/components/base/tab-slider'

const Container = () => {
  const options = [
    {
      value: 'dataset',
      text: 'DATASETS',
    },
    {
      value: 'api',
      text: 'API ACCESS',
    },
  ]
  const [activeTab, setActiveTab] = useState('dataset')

  return (
    <div className='grow h-0 flex flex-col bg-gray-100 overflow-y-auto'>
      <div className='sticky top-0 flex justify-between pt-4 px-12 pb-2 h-14 bg-gray-100 z-10'>
        <TabSlider
          value={activeTab}
          onChange={newActiveTab => setActiveTab(newActiveTab)}
          options={options}
        />
        {
          activeTab === 'api' && (
            <ApiServer />
          )
        }
      </div>
      {
        activeTab === 'dataset' && (
          <div className=''>
            <Datasets />
            <DatasetFooter />
          </div>
        )
      }
      {
        activeTab === 'api' && (
          <Doc />
        )
      }
    </div>
  )
}

export default Container
