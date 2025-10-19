import React from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowRunningData } from '@/app/components/workflow/types'
import Tab from './tab'

type TabsProps = {
  currentTab: string
  workflowRunningData?: WorkflowRunningData
  switchTab: (tab: string) => void
}

const Tabs = ({
  currentTab,
  workflowRunningData,
  switchTab,
}: TabsProps) => {
  const { t } = useTranslation()
  return (
    <div className='flex shrink-0 items-center gap-x-6 border-b-[0.5px] border-divider-subtle px-4'>
      <Tab
        isActive={currentTab === 'RESULT'}
        label={t('runLog.result')}
        value='RESULT'
        workflowRunningData={workflowRunningData}
        onClick={switchTab}
      />
      <Tab
        isActive={currentTab === 'DETAIL'}
        label={t('runLog.detail')}
        value='DETAIL'
        workflowRunningData={workflowRunningData}
        onClick={switchTab}
      />
      <Tab
        isActive={currentTab === 'TRACING'}
        label={t('runLog.tracing')}
        value='TRACING'
        workflowRunningData={workflowRunningData}
        onClick={switchTab}
      />
    </div>
  )
}

export default React.memo(Tabs)
