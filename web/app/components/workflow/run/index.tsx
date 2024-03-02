'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Result from './result'
import Tracing from './tracing'

type RunProps = {
  activeTab: 'RESULT' | 'TRACING'
  appId: string
}

const RunPanel: FC<RunProps> = ({ activeTab, appId }) => {
  const { t } = useTranslation()
  const [currentTab, setCurrentTab] = useState<string>(activeTab)

  return (
    <div className='grow relative flex flex-col'>
      {/* tab */}
      <div className='shrink-0 flex items-center px-4 border-b-[0.5px] border-[rgba(0,0,0,0.05)]'>
        <div
          className={cn(
            'mr-6 py-3 border-b-2 border-transparent text-[13px] font-semibold leading-[18px] text-gray-400 cursor-pointer',
            currentTab === 'RESULT' && '!border-[rgb(21,94,239)] text-gray-700',
          )}
          onClick={() => setCurrentTab('RESULT')}
        >{t('runLog.result')}</div>
        <div
          className={cn(
            'mr-6 py-3 border-b-2 border-transparent text-[13px] font-semibold leading-[18px] text-gray-400 cursor-pointer',
            currentTab === 'TRACING' && '!border-[rgb(21,94,239)] text-gray-700',
          )}
          onClick={() => setCurrentTab('TRACING')}
        >{t('runLog.tracing')}</div>
      </div>
      {/* panel detal */}
      <div className={cn('grow bg-white overflow-y-auto', currentTab === 'TRACING' && '!bg-gray-50')}>
        {currentTab === 'RESULT' && <Result appId={appId}/>}
        {currentTab === 'TRACING' && <Tracing appId={appId}/>}
      </div>
    </div>
  )
}

export default RunPanel
