import type { FC } from 'react'
import type { TFunction } from 'i18next'
import { RiPlayList2Line } from '@remixicon/react'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { Markdown } from '@/app/components/base/markdown'
import type { SiteInfo } from '@/models/share'
import cn from '@/utils/classnames'
import ResultTab from './result-tab'

type ContentSectionProps = {
  workflowProcessData?: WorkflowProcess
  taskId?: string
  depth: number
  isError: boolean
  content: any
  hideProcessDetail?: boolean
  siteInfo: SiteInfo | null
  currentTab: 'DETAIL' | 'RESULT'
  onSwitchTab: (tab: 'DETAIL' | 'RESULT') => void
  showResultTabs: boolean
  t: TFunction
  inSidePanel?: boolean
}

const ContentSection: FC<ContentSectionProps> = ({
  workflowProcessData,
  taskId,
  depth,
  isError,
  content,
  hideProcessDetail,
  siteInfo,
  currentTab,
  onSwitchTab,
  showResultTabs,
  t,
  inSidePanel,
}) => {
  return (
    <div className={cn(
      'relative',
      !inSidePanel && 'rounded-2xl border-t border-divider-subtle bg-chat-bubble-bg',
    )}>
      {workflowProcessData && (
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
            {siteInfo && workflowProcessData && (
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
      )}
      {!workflowProcessData && taskId && (
        <div className={cn('system-2xs-medium-uppercase sticky left-0 top-0 flex w-full items-center rounded-t-2xl bg-components-actionbar-bg p-4 pb-3 text-text-accent-secondary', isError && 'text-text-destructive')}>
          <RiPlayList2Line className='mr-1 h-3 w-3' />
          <span>{t('share.generation.execution')}</span>
          <span className='px-1'>·</span>
          <span>{`${taskId}${depth > 1 ? `-${depth - 1}` : ''}`}</span>
        </div>
      )}
      {isError && (
        <div className='body-lg-regular p-4 pt-0 text-text-quaternary'>{t('share.generation.batchFailed.outputPlaceholder')}</div>
      )}
      {!workflowProcessData && !isError && (typeof content === 'string') && (
        <div className={cn('p-4', taskId && 'pt-0')}>
          <Markdown content={content} />
        </div>
      )}
    </div>
  )
}

export default ContentSection
