import {
  memo,
  useState,
} from 'react'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import { useStore } from '@/app/components/workflow/store'
import {
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import Loading from '@/app/components/base/loading'
import Tabs from './tabs'
import ResultPreview from './result-preview'

const Result = () => {
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const [currentTab, setCurrentTab] = useState<string>('RESULT')

  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
  }

  return (
    <div className='flex grow flex-col'>
      <Tabs currentTab={currentTab} workflowRunningData={workflowRunningData} switchTab={switchTab} />
      <div className='flex h-0 grow flex-col overflow-y-auto'>
        {currentTab === 'RESULT' && (
          <ResultPreview
            isRunning={!workflowRunningData?.result || workflowRunningData?.result.status === WorkflowRunningStatus.Running}
            outputs={workflowRunningData?.result?.outputs}
            error={workflowRunningData?.result?.error}
            onSwitchToDetail={() => switchTab('DETAIL')}
          />
        )}
        {currentTab === 'DETAIL' && (
          <ResultPanel
            inputs={workflowRunningData?.result?.inputs}
            outputs={workflowRunningData?.result?.outputs}
            status={workflowRunningData?.result?.status || ''}
            error={workflowRunningData?.result?.error}
            elapsed_time={workflowRunningData?.result?.elapsed_time}
            total_tokens={workflowRunningData?.result?.total_tokens}
            created_at={workflowRunningData?.result?.created_at}
            created_by={(workflowRunningData?.result?.created_by as any)?.name}
            steps={workflowRunningData?.result?.total_steps}
            exceptionCounts={workflowRunningData?.result?.exceptions_count}
          />
        )}
        {currentTab === 'DETAIL' && !workflowRunningData?.result && (
          <div className='flex grow items-center justify-center'>
            <Loading />
          </div>
        )}
        {currentTab === 'TRACING' && (
          <TracingPanel
            className='bg-background-section-burn'
            list={workflowRunningData?.tracing || []}
          />
        )}
        {currentTab === 'TRACING' && !workflowRunningData?.tracing?.length && (
          <div className='flex grow items-center justify-center'>
            <Loading />
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(Result)
