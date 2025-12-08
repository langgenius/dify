import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiPlayList2Line } from '@remixicon/react'
import ResultTab from './result-tab'
import type { WorkflowTab } from './hooks'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import cn from '@/utils/classnames'

type WorkflowContentProps = {
  workflowProcessData: WorkflowProcess
  taskId?: string
  isError: boolean
  hideProcessDetail?: boolean
  siteInfo: SiteInfo | null
  currentTab: WorkflowTab
  onSwitchTab: (tab: WorkflowTab) => void
  content: any
}

const WorkflowContent: FC<WorkflowContentProps> = ({
  workflowProcessData,
  taskId,
  isError,
  hideProcessDetail,
  siteInfo,
  currentTab,
  onSwitchTab,
  content,
}) => {
  const { t } = useTranslation()
  const showResultTabs = !!workflowProcessData?.resultText || !!workflowProcessData?.files?.length

  return (
    <>
      <div className={cn(
        'p-3',
        showResultTabs && 'border-b border-divider-subtle',
      )}>
        {taskId && (
          <div className={cn('system-2xs-medium-uppercase mb-2 flex items-center text-text-accent-secondary', isError && 'text-text-destructive')}>
            <RiPlayList2Line className='mr-1 h-3 w-3' />
            <span>{t('share.generation.execution')}</span>
            <span className='px-1'>·</span>
            <span>{taskId}</span>
          </div>
        )}
        {siteInfo && (
          <WorkflowProcessItem
            data={workflowProcessData}
            expand={workflowProcessData.expand}
            hideProcessDetail={hideProcessDetail}
            hideInfo={hideProcessDetail}
            readonly={!siteInfo.show_workflow_steps}
          />
        )}
        {showResultTabs && (
          <div className='flex items-center space-x-6 px-1'>
            <div
              className={cn(
                'system-sm-semibold-uppercase cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary',
                currentTab === 'RESULT' && 'border-util-colors-blue-brand-blue-brand-600 text-text-primary',
              )}
              onClick={() => onSwitchTab('RESULT')}
            >{t('runLog.result')}</div>
            <div
              className={cn(
                'system-sm-semibold-uppercase cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary',
                currentTab === 'DETAIL' && 'border-util-colors-blue-brand-blue-brand-600 text-text-primary',
              )}
              onClick={() => onSwitchTab('DETAIL')}
            >{t('runLog.detail')}</div>
          </div>
        )}
      </div>
      {!isError && (
        <ResultTab data={workflowProcessData} content={content} currentTab={currentTab} />
      )}
    </>
  )
}

export default WorkflowContent
