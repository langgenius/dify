'use client'
import type { FC } from 'react'
// import React, { useState } from 'react'
// import { useTranslation } from 'react-i18next'
// import cn from 'classnames'
import StatusPanel from './status'
import MetaData from './meta'
// import Loading from '@/app/components/base/loading'

type ResultProps = {
  // appId: string
}

const Result: FC<ResultProps> = () => {
  // const { t } = useTranslation()
  // const [currentTab, setCurrentTab] = useState<string>(activeTab)

  return (
    <div className='bg-white py-2'>
      <div className='px-4 py-2'>
        <StatusPanel status={'running'} time={0.653} tokens={27} />
      </div>
      <div className='px-4 py-2'>
        <StatusPanel status={'succeeded'} time={0.653} tokens={27} />
      </div>
      <div className='px-4 py-2'>
        <StatusPanel status={'failed'} time={0.653} tokens={27} error='Fail message here' />
      </div>
      <div className='px-4 py-2'>
        <StatusPanel status={'stopped'} time={0.653} tokens={27} />
      </div>
      <div className='px-4 py-2 flex flex-col gap-2'>
        <div>INPUT TODO</div>
        <div>OUPUT TODO</div>
      </div>
      <div className='px-4 py-2'>
        <div className='h-[0.5px] bg-black opacity-5'/>
      </div>
      <div className='px-4 py-2'>
        <MetaData status={'running'} />
      </div>
      <div className='px-4 py-2'>
        <MetaData status={'succeeded'} executor={'Vince'} startTime={1702972783} time={0.653} tokens={27} fee={0.035} currency={'USD'} steps={7} />
      </div>
    </div>
  )
}

export default Result
