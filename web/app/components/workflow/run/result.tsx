'use client'
import type { FC } from 'react'
// import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
// import cn from 'classnames'
import StatusPanel from './status'
// import Loading from '@/app/components/base/loading'
// import Indicator from '@/app/components/header/indicator'

type ResultProps = {
  appId: string
}

const Result: FC<ResultProps> = ({ appId }) => {
  const { t } = useTranslation()
  // const [currentTab, setCurrentTab] = useState<string>(activeTab)

  return (
    <div className='bg-white py-2'>
      <div className='px-4 py-2'>
        <StatusPanel status='running' time={0.653} tokens={27} />
      </div>
      <div className='px-4 py-2'>
        <StatusPanel status='succeeded' time={0.653} tokens={27} />
      </div>
      <div className='px-4 py-2'>
        <StatusPanel status='failed' time={0.653} tokens={27} />
      </div>
      <div className='px-4 py-2'>
        <StatusPanel status='stopped' time={0.653} tokens={27} />
      </div>
      <div className='px-4 py-2 flex flex-col gap-2'>
        <div>INPUT TODO</div>
        <div>OUPUT TODO</div>
      </div>
      <div className='px-4 py-2'>
        <div className='h-[0.5px] bg-[rbga(0,0,0,0.05)]'/>
      </div>
      <div className='px-4 py-2'>META DATA TODO</div>
    </div>
  )
}

export default Result
